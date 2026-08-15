#Requires -Version 7.0
<#
.SYNOPSIS
  Builds, packages, and (optionally) locally installs the OrderRestro
  Windows MSIX client. Windows-only — requires the .NET 8 SDK plus the
  Windows 10/11 SDK (for makeappx.exe/signtool.exe, normally on PATH from a
  "Developer PowerShell for VS" prompt, or installable standalone). Not
  runnable on Linux/macOS; the reference build/validation run for this
  script is the GitHub Actions `windows-msix.yml` workflow (windows-latest
  runner), not this repo's own Linux dev environment.

.DESCRIPTION
  Uses the classic, widely-documented "Desktop Bridge" packaging flow for a
  plain WinForms app rather than MSBuild's single-project-MSIX tooling:
    1. `dotnet publish` the WinForms launcher (self-contained, single-file,
       win-x64).
    2. Stage the published output + Assets/ + AppxManifest.xml into one
       folder (the exact shape Windows expects inside an .msix).
    3. `makeappx pack` that folder into OrderRestro.msix.
    4. Optionally sign it with a throwaway self-signed test cert
       (-SelfSignedTest) and/or install it locally (-InstallLocally) for a
       real install/launch round-trip.

.PARAMETER Configuration
  Release (default) or Debug.

.PARAMETER SelfSignedTest
  Generates (or reuses) a throwaway self-signed code-signing certificate
  under $env:LOCALAPPDATA\OrderRestro\dev-cert, signs the package with it,
  and trusts it into CurrentUser\TrustedPeople so `Add-AppxPackage`
  succeeds locally. FOR LOCAL/CI TEST INSTALLS ONLY — never use this cert
  for a real Store or sideload distribution; Partner Center issues the
  real signing identity at submission time (see windows/msix/README.md).

.PARAMETER InstallLocally
  After a successful -SelfSignedTest build, runs Add-AppxPackage to
  actually install the package on the current machine (used by CI to get a
  real install/launch PASS signal, not just "it compiled").

.EXAMPLE
  ./build-windows-msix.ps1 -SelfSignedTest -InstallLocally
#>
param(
    [ValidateSet('Release', 'Debug')]
    [string]$Configuration = 'Release',

    [ValidateSet('x64')]
    [string]$Platform = 'x64',

    [switch]$SelfSignedTest,

    [switch]$InstallLocally
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path   # windows/msix
$launcherProj = Join-Path $root 'Launcher/Launcher.csproj'
$manifestSrc = Join-Path $root 'AppxManifest.xml'
$assetsSrc = Join-Path $root 'Assets'
$publishDir = Join-Path $root 'out/publish'
$stageDir = Join-Path $root 'out/stage'
$msixOut = Join-Path $root 'out/OrderRestro.msix'

Write-Host "== OrderRestro Windows MSIX build ==" -ForegroundColor Cyan
Write-Host "Configuration=$Configuration Platform=$Platform" -ForegroundColor Cyan

foreach ($tool in 'dotnet', 'makeappx') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool not found on PATH. Install the .NET 8 SDK and the Windows " +
              "10/11 SDK (makeappx.exe ships with it — run from a 'Developer " +
              "PowerShell for VS' prompt if it's not directly on PATH)."
    }
}

# --- 1. Publish the WinForms launcher --------------------------------------
Remove-Item -Recurse -Force $publishDir, $stageDir, $msixOut -ErrorAction SilentlyContinue
& dotnet publish $launcherProj -c $Configuration -r "win-$Platform" -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

$exePath = Join-Path $publishDir 'OrderRestro.exe'
if (-not (Test-Path $exePath)) { throw "Publish succeeded but OrderRestro.exe was not found at $exePath" }

# --- 2. Stage the package layout --------------------------------------------
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Copy-Item -Path (Join-Path $publishDir '*') -Destination $stageDir -Recurse -Force
Copy-Item -Path $assetsSrc -Destination (Join-Path $stageDir 'Assets') -Recurse -Force
Copy-Item -Path $manifestSrc -Destination (Join-Path $stageDir 'AppxManifest.xml') -Force

# --- 3. Pack ------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path (Split-Path $msixOut) | Out-Null
& makeappx pack /d $stageDir /p $msixOut /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed with exit code $LASTEXITCODE" }
Write-Host "Built package: $msixOut" -ForegroundColor Green

# --- 4. Optional: sign with a throwaway local test certificate -------------
if ($SelfSignedTest) {
    if (-not (Get-Command signtool -ErrorAction SilentlyContinue)) {
        throw "signtool not found on PATH — required for -SelfSignedTest. Install the Windows 10/11 SDK."
    }
    $certDir = Join-Path $env:LOCALAPPDATA 'OrderRestro\dev-cert'
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    $pfxPath = Join-Path $certDir 'orderrestro-dev.pfx'
    $cerPath = Join-Path $certDir 'orderrestro-dev.cer'
    $subject = 'CN=REPLACE-WITH-YOUR-PARTNER-CENTER-PUBLISHER-ID'

    $existing = Get-ChildItem Cert:\CurrentUser\My |
        Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date) } |
        Select-Object -First 1

    if (-not $existing) {
        Write-Host "Generating throwaway self-signed test cert ($subject)..." -ForegroundColor Yellow
        $existing = New-SelfSignedCertificate `
            -Type Custom `
            -Subject $subject `
            -KeyUsage DigitalSignature `
            -FriendlyName "OrderRestro dev-only test cert" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
        $pwd = ConvertTo-SecureString -String "orderrestro-dev" -Force -AsPlainText
        Export-PfxCertificate -Cert $existing -FilePath $pfxPath -Password $pwd | Out-Null
        Export-Certificate -Cert $existing -FilePath $cerPath | Out-Null
        # Trust it locally so Add-AppxPackage doesn't reject an untrusted
        # signer — this is what makes it a TEST-ONLY cert; never do this on
        # an end-user machine.
        Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
    }
    elseif (-not (Test-Path $pfxPath)) {
        throw "Found existing cert '$subject' in the store but no matching .pfx at $pfxPath — delete the cert from Cert:\CurrentUser\My and re-run to regenerate both together."
    }

    $pwd = ConvertTo-SecureString -String "orderrestro-dev" -Force -AsPlainText
    & signtool sign /fd SHA256 /a /f $pfxPath /p "orderrestro-dev" $msixOut
    if ($LASTEXITCODE -ne 0) { throw "signtool sign failed with exit code $LASTEXITCODE" }
    Write-Host "Signed with dev-only test certificate." -ForegroundColor Green
}
else {
    Write-Host "Built UNSIGNED package (no -SelfSignedTest). Store submission " -ForegroundColor Yellow
    Write-Host "signs automatically on upload; sideload installs need a signed" -ForegroundColor Yellow
    Write-Host "package — re-run with -SelfSignedTest for a local install test." -ForegroundColor Yellow
}

# --- 5. Optional: real local install/uninstall round-trip ------------------
if ($InstallLocally) {
    if (-not $SelfSignedTest) {
        throw "-InstallLocally requires -SelfSignedTest (Windows refuses to install an unsigned package)."
    }
    Write-Host "Installing $msixOut via Add-AppxPackage..." -ForegroundColor Cyan
    Add-AppxPackage -Path $msixOut -ErrorAction Stop
    $installed = Get-AppxPackage -Name 'NodedrInfotech.OrderRestro'
    if (-not $installed) { throw "Add-AppxPackage reported success but Get-AppxPackage found nothing." }
    Write-Host "Installed: $($installed.PackageFullName)" -ForegroundColor Green
    Write-Host "Verify manually (Start Menu entry, launch, no UAC prompt), then:" -ForegroundColor Cyan
    Write-Host "  Remove-AppxPackage -Package '$($installed.PackageFullName)'" -ForegroundColor Cyan
}

Write-Host "Done." -ForegroundColor Green
