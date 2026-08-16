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

.EXAMPLE
    ./validate-msix.ps1
    ./validate-msix.ps1 -MsixPath .\out\OrderRestro.msix
    ./validate-msix.ps1 -AllowPlaceholderPublisher   # CI/local self-signed test builds only
#>
[CmdletBinding()]
param(
    [string]$MsixPath = (Join-Path $PSScriptRoot 'out\OrderRestro.msix'),
    [switch]$AllowPlaceholderPublisher
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
    Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

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
        $forbiddenPatterns = @(
            '*.pdb', '*.env', '.env*', '*.ts', '*.tsx', '*.cs', '*.csproj',
            'docker-compose*.yml', 'package.json', 'pnpm-lock.yaml',
            'appsettings.*.json'
        )
        $forbiddenDirs = @('node_modules', '.git', 'test', 'tests', '__tests__')
        $hits = @()
        foreach ($pattern in $forbiddenPatterns) {
            $hits += Get-ChildItem -Path $tempDir -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue
        }
        foreach ($dirName in $forbiddenDirs) {
            $hits += Get-ChildItem -Path $tempDir -Filter $dirName -Recurse -Directory -ErrorAction SilentlyContinue
        }
        if ($hits.Count -gt 0) {
            $names = ($hits | Select-Object -First 10 -ExpandProperty FullName) -join "; "
            throw "Found $($hits.Count) forbidden dev/build artifact(s) in the package: $names"
        }
    }

    Test-Check "Launcher executable and WebView2Loader.dll are present" {
        $exe = Get-ChildItem -Path $tempDir -Filter 'OrderRestro.exe' -Recurse -File -ErrorAction SilentlyContinue
        if (-not $exe) { throw "OrderRestro.exe not found in package — publish/staging likely failed silently" }
        $loader = Get-ChildItem -Path $tempDir -Filter 'WebView2Loader.dll' -Recurse -File -ErrorAction SilentlyContinue
        if (-not $loader) { throw "WebView2Loader.dll not found — the launcher will fail at runtime with no native WebView2 loader present" }
    }

    Test-Check "Required visual assets are present" {
        $required = @('Square150x150Logo.png', 'Square44x44Logo.png', 'StoreLogo.png', 'SplashScreen.png')
        foreach ($name in $required) {
            $found = Get-ChildItem -Path $tempDir -Filter $name -Recurse -File -ErrorAction SilentlyContinue
            if (-not $found) { throw "Missing required asset: $name" }
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
