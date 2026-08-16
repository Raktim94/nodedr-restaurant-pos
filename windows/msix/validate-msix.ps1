#Requires -Version 5.1
<#
.SYNOPSIS
    Sanity-checks a built OrderRestro.msix before install-testing, sideload
    distribution, or Store submission. Does NOT replace the Windows App
    Certification Kit (WACK) — run that too before a real Store submission
    (see README.md "Store submission checklist").

.DESCRIPTION
    Unpacks the .msix (it's a zip container) into a temp directory and checks:
      1. AppxManifest.xml inside the package parses and has a real (non-
         placeholder) Publisher identity.
      2. Declared <Capability>/<rescap:Capability> names are on an explicit
         allow-list (internetClient, runFullTrust) — fails loudly if anything
         broader (broadFileSystemAccess, any device-class capability, etc.)
         ever gets added, since that would silently violate the hardening
         brief's minimum-capability requirement.
      3. No development/build/secret artifacts shipped inside the package
         (.pdb, .env, source .ts/.js/.cs, node_modules, .git, docker-compose
         files, test files).
      4. The launcher executable and WebView2Loader native dependency are
         actually present (a publish/staging mistake could produce a package
         that installs but can't launch).
      5. If the package is signed, runs `signtool verify /pa` and reports
         the result. An unsigned package is reported as such, not as a
         failure — local Developer-Mode testing intentionally uses unsigned
         packages.

.PARAMETER MsixPath
    Path to the .msix to validate. Defaults to ./out/OrderRestro.msix (the
    build-windows-msix.ps1 default output location).

.PARAMETER AllowPlaceholderPublisher
    Downgrades the placeholder-Publisher check from a failure to a warning.
    ONLY for a package built with build-windows-msix.ps1's -SelfSignedTest
    (which deliberately signs with a throwaway cert whose subject is that
    same placeholder CN, so Publisher == signer for a local/CI install
    round-trip to succeed at all). Do not pass this when validating a
    package meant for real sideload/Store submission — the default
    (without this switch) is the loud, ship-blocking failure the
    placeholder is meant to produce.

.PARAMETER ExpectEmbeddedServer
    Set when validating a package built with build-windows-msix.ps1's
    -IncludeEmbeddedServer. A real Node.js/Postgres dependency tree
    legitimately contains package.json, node_modules, and test/ folders
    by the thousand (every installed npm package ships its own) — the
    generic dev-artifact check's node_modules/package.json/test-folder
    patterns would be near-100%-false-positive against that, so this
    switch scopes that check to skip the server\ subtree and instead runs
    a small set of checks purpose-built for it (see "server assets" checks
    below): the embedded runtime binaries are actually present, and
    nothing that WOULD still be a real problem there (.env, .pdb, .git) is.

.EXAMPLE
    ./validate-msix.ps1
    ./validate-msix.ps1 -MsixPath .\out\OrderRestro.msix
    ./validate-msix.ps1 -AllowPlaceholderPublisher   # CI/local self-signed test builds only
    ./validate-msix.ps1 -ExpectEmbeddedServer        # packages built with -IncludeEmbeddedServer
#>
[CmdletBinding()]
param(
    [string]$MsixPath = (Join-Path $PSScriptRoot 'out\OrderRestro.msix'),
    [switch]$AllowPlaceholderPublisher,
    [switch]$ExpectEmbeddedServer
)

$ErrorActionPreference = 'Stop'
$failures = @()
$warnings = @()

function Test-Check {
    param([string]$Name, [scriptblock]$Body)
    Write-Host "==> $Name" -ForegroundColor Cyan
    try {
        & $Body
        Write-Host "    PASS" -ForegroundColor Green
    } catch {
        Write-Host "    FAIL: $($_.Exception.Message)" -ForegroundColor Red
        $script:failures += "$Name`: $($_.Exception.Message)"
    }
}

if (-not (Test-Path $MsixPath)) {
    throw "Package not found at $MsixPath. Run build-windows-msix.ps1 first, or pass -MsixPath."
}
Write-Host "Validating: $MsixPath`n" -ForegroundColor White

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("orderrestro-validate-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
try {
    $zipPath = Join-Path $tempDir 'package.zip'
    Copy-Item $MsixPath $zipPath
    # Expand-Archive's cmdlet layer adds real per-file overhead on an
    # archive with tens of thousands of small files (an embedded-server
    # build's node_modules) — call the same underlying API directly instead.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $tempDir)

    Write-Host "Enumerating package contents..." -ForegroundColor DarkGray
    # One filesystem walk instead of ~15 separate `Get-ChildItem -Recurse`
    # passes (one per forbidden pattern/dir, repeated per check below) —
    # each full-tree walk was getting materially slower as the embedded-
    # server package grew to tens of thousands of real (dereferenced)
    # files. Every check below filters these in-memory lists instead.
    $allFiles = Get-ChildItem -Path $tempDir -Recurse -File -ErrorAction SilentlyContinue
    $allDirs = Get-ChildItem -Path $tempDir -Recurse -Directory -ErrorAction SilentlyContinue
    Write-Host "  $($allFiles.Count) files, $($allDirs.Count) directories" -ForegroundColor DarkGray

    $manifestPath = Join-Path $tempDir 'AppxManifest.xml'
    [xml]$manifest = $null

    Test-Check "AppxManifest.xml present and parses" {
        if (-not (Test-Path $manifestPath)) { throw "AppxManifest.xml missing from package root" }
        $script:manifest = [xml](Get-Content $manifestPath)
    }

    Test-Check "Publisher identity is not the placeholder" {
        $publisher = $manifest.Package.Identity.Publisher
        if ([string]::IsNullOrWhiteSpace($publisher)) { throw "Publisher is empty" }
        if ($publisher -match 'REPLACE-WITH-YOUR-PARTNER-CENTER-PUBLISHER-ID') {
            if ($AllowPlaceholderPublisher) {
                $script:warnings += "Publisher is still the placeholder CN — expected for a -SelfSignedTest build, but this package must NOT be sideloaded/submitted as-is."
            } else {
                throw "Publisher is still the placeholder — set the real Partner Center CN before shipping this package (pass -AllowPlaceholderPublisher only for a -SelfSignedTest build)"
            }
        }
    }

    Test-Check "Package identity (Name/Version/Architecture) is well-formed" {
        $identity = $manifest.Package.Identity
        if ([string]::IsNullOrWhiteSpace($identity.Name)) { throw "Identity Name is empty" }
        if ($identity.Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
            throw "Version '$($identity.Version)' is not in required Major.Minor.Build.Revision form"
        }
        if ($identity.ProcessorArchitecture -ne 'x64') {
            throw "ProcessorArchitecture is '$($identity.ProcessorArchitecture)', expected x64"
        }
    }

    Test-Check "Declared capabilities are on the minimal allow-list" {
        $allowed = @('internetClient', 'runFullTrust')
        $ns = New-Object System.Xml.XmlNamespaceManager($manifest.NameTable)
        $ns.AddNamespace('a', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
        $ns.AddNamespace('rescap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')
        $capNodes = $manifest.SelectNodes('//a:Capabilities/*', $ns)
        if ($capNodes.Count -eq 0) { throw "No <Capabilities> declared — expected at least internetClient" }
        $declared = @()
        foreach ($node in $capNodes) {
            # Use LocalName, not Name: PowerShell's XML adapter lets an
            # attribute literally called "Name" (every Capability element
            # has one) shadow XmlElement's real .Name property, so
            # $node.Name here returns the attribute VALUE (e.g.
            # "internetClient") instead of the tag name ("Capability").
            # LocalName has no such conflict and also strips any rescap:
            # prefix on its own, so a single check covers both.
            $capName = $node.LocalName
            if ($capName -ne 'Capability') {
                throw "Unexpected capability element '$capName' — only Capability/rescap:Capability are expected"
            }
            $declared += $capName
            $nameAttr = $node.GetAttribute('Name')
            if ($allowed -notcontains $nameAttr) {
                throw "Capability '$nameAttr' is not on the minimal allow-list ($($allowed -join ', ')). If this is intentional, update this script's allow-list AND document why in AppxManifest.xml."
            }
        }
    }

    Test-Check "No USB/device/driver capabilities present" {
        $forbidden = 'usb|serialCommunication|bluetooth|pointOfService|deviceUnlock|broadFileSystemAccess|documentsLibrary'
        $raw = Get-Content $manifestPath -Raw
        # Strip XML comments first — AppxManifest.xml documents, in a
        # comment, exactly which device capabilities are deliberately NOT
        # requested, and a raw-text match matches that explanation too.
        $rawNoComments = [regex]::Replace($raw, '<!--.*?-->', '', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($rawNoComments -match $forbidden) {
            throw "Manifest references a forbidden capability/keyword matching /$forbidden/ — Windows client must not request raw device access (see hardening brief section 2/17)"
        }
    }

    Test-Check "No development/build/secret artifacts shipped" {
        $forbiddenFilePatterns = @(
            '*.pdb', '*.env', '.env*', '*.ts', '*.tsx', '*.cs', '*.csproj',
            'docker-compose*.yml', 'package.json', 'pnpm-lock.yaml',
            'appsettings.*.json'
        )
        $forbiddenDirNames = @('node_modules', '.git', 'test', 'tests', '__tests__')
        # A real Node/Postgres dependency tree under server\ legitimately
        # contains thousands of package.json/node_modules/test folders —
        # every installed npm package ships its own. This check keeps its
        # full strictness for the Launcher\ half of the package (where none
        # of that is ever legitimate) and is scoped to skip server\
        # entirely — that subtree gets its own purpose-built checks below.
        $serverDir = Join-Path $tempDir 'server'
        $scopeFiles = $allFiles
        $scopeDirs = $allDirs
        if ($ExpectEmbeddedServer) {
            $scopeFiles = $scopeFiles | Where-Object { -not $_.FullName.StartsWith($serverDir, [StringComparison]::OrdinalIgnoreCase) }
            $scopeDirs = $scopeDirs | Where-Object { -not $_.FullName.StartsWith($serverDir, [StringComparison]::OrdinalIgnoreCase) }
        }
        $fileHits = $scopeFiles | Where-Object { $name = $_.Name; ($forbiddenFilePatterns | Where-Object { $name -like $_ }).Count -gt 0 }
        $dirHits = $scopeDirs | Where-Object { $forbiddenDirNames -contains $_.Name }
        $hits = @($fileHits) + @($dirHits)
        if ($hits.Count -gt 0) {
            $names = ($hits | Select-Object -First 10 -ExpandProperty FullName) -join "; "
            throw "Found $($hits.Count) forbidden dev/build artifact(s) in the package: $names"
        }
    }

    if ($ExpectEmbeddedServer) {
        Test-Check "Embedded server runtime assets are present" {
            $serverDir = Join-Path $tempDir 'server'
            $required = @(
                'postgres\bin\pg_ctl.exe',
                'postgres\bin\initdb.exe',
                'postgres\bin\postgres.exe',
                'node\node.exe',
                'backend\dist\src\main.js',
                'backend\node_modules\prisma\build\index.js',
                'web\apps\web\server.js'
            )
            foreach ($rel in $required) {
                if (-not (Test-Path (Join-Path $serverDir $rel))) {
                    throw "Missing embedded server asset: server\$rel — stage-server-assets.ps1 likely failed silently or its output layout changed without this check being updated"
                }
            }
        }

        Test-Check "No real secrets baked into the embedded server assets" {
            # backend.env (with the real, generated JWT_SECRET) is written
            # at RUNTIME to %LOCALAPPDATA%\OrderRestro\server\ — it must
            # never exist inside the built package itself. .pdb/.git
            # likewise have no legitimate reason to appear even inside a
            # real node_modules tree.
            $serverDir = Join-Path $tempDir 'server'
            $serverFiles = $allFiles | Where-Object { $_.FullName.StartsWith($serverDir, [StringComparison]::OrdinalIgnoreCase) }
            $serverDirs = $allDirs | Where-Object { $_.FullName.StartsWith($serverDir, [StringComparison]::OrdinalIgnoreCase) }
            $patterns = '*.env', '.env*', '*.pdb'
            $fileHits = $serverFiles | Where-Object { $name = $_.Name; ($patterns | Where-Object { $name -like $_ }).Count -gt 0 }
            $dirHits = $serverDirs | Where-Object { $_.Name -eq '.git' }
            $hits = @($fileHits) + @($dirHits)
            if ($hits.Count -gt 0) {
                $names = ($hits | Select-Object -First 10 -ExpandProperty FullName) -join "; "
                throw "Found $($hits.Count) forbidden file(s) under server\: $names"
            }
        }
    }

    Test-Check "Launcher executable and WebView2Loader.dll are present" {
        if (-not ($allFiles | Where-Object Name -eq 'OrderRestro.exe')) { throw "OrderRestro.exe not found in package — publish/staging likely failed silently" }
        if (-not ($allFiles | Where-Object Name -eq 'WebView2Loader.dll')) { throw "WebView2Loader.dll not found — the launcher will fail at runtime with no native WebView2 loader present" }
    }

    Test-Check "Required visual assets are present" {
        $required = @('Square150x150Logo.png', 'Square44x44Logo.png', 'StoreLogo.png', 'SplashScreen.png')
        $presentNames = $allFiles | Where-Object { $required -contains $_.Name } | Select-Object -ExpandProperty Name -Unique
        foreach ($name in $required) {
            if ($presentNames -notcontains $name) { throw "Missing required asset: $name" }
        }
    }

    if (Get-Command signtool -ErrorAction SilentlyContinue) {
        Write-Host "==> Signature check (signtool verify /pa)" -ForegroundColor Cyan
        & signtool verify /pa $MsixPath 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    PASS: package is signed with a chain signtool trusts" -ForegroundColor Green
        } else {
            Write-Host "    UNSIGNED or untrusted signature (exit $LASTEXITCODE) — expected for a local Developer-Mode test build; must be resolved before Store submission" -ForegroundColor Yellow
            $warnings += "Package is unsigned or has an untrusted signature — fine for local sideload testing with Developer Mode, not for Store submission or production sideload."
        }
    } else {
        $warnings += "signtool not found on PATH — signature was not checked. Install the Windows 10/11 SDK to enable this check."
    }

} finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}

Write-Host ""
if ($warnings.Count -gt 0) {
    Write-Host "Warnings:" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}

if ($failures.Count -gt 0) {
    Write-Host "`n$($failures.Count) check(s) FAILED:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "`nAll structural checks passed." -ForegroundColor Green
Write-Host "This script does NOT replace the Windows App Certification Kit (WACK) or actual install/launch/print testing on real Windows hardware — see README.md `"Testing`" section." -ForegroundColor Yellow
# Explicit exit 0: without this, the process exit code falls back to
# whatever $LASTEXITCODE was left by the last native tool invocation
# (signtool verify, which legitimately returns nonzero for an expected
# unsigned test build) even though every check above actually passed.
exit 0
