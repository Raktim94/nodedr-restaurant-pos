<#
.SYNOPSIS
  Installs OrderRestro.msix on a normal Windows 10/11 PC (outside the Microsoft Store).

.DESCRIPTION
  Windows refuses an .msix whose signing certificate it does not trust ("The
  app package's publisher certificate could not be verified"). This script
  reads the certificate the package is signed with, trusts it for app
  installs only (the "Trusted People" store, not the root store), then
  installs the package. Safe to run again to update an existing install:
  local data is kept.

  Usually started through Install-OrderRestro.cmd (double-click).
#>
[CmdletBinding()]
param(
    [string]$Msix,
    [switch]$NoLaunch,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

function Wait-Exit([int]$code) {
    if (-not $NoPause) { Write-Host ''; Read-Host 'Press Enter to close' | Out-Null }
    exit $code
}

try {
    if (-not $Msix) {
        $found = Get-ChildItem -Path $PSScriptRoot -Filter *.msix -File | Select-Object -First 1
        if (-not $found) { throw "No .msix file found next to this script ($PSScriptRoot). Keep OrderRestro.msix in the same folder." }
        $Msix = $found.FullName
    }
    $Msix = (Resolve-Path -LiteralPath $Msix).Path

    # Trusting a certificate needs administrator rights: ask for them once.
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host 'Asking for administrator permission (needed once, to trust the app certificate)...'
        $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Msix', "`"$Msix`"")
        if ($NoLaunch) { $args += '-NoLaunch' }
        if ($NoPause) { $args += '-NoPause' }
        $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -Verb RunAs -Wait -PassThru
        exit $p.ExitCode
    }

    if ([Environment]::OSVersion.Version.Build -lt 17763) {
        throw 'OrderRestro needs Windows 10 version 1809 or newer (or Windows 11).'
    }

    Write-Host "Package: $Msix"
    $sig = Get-AuthenticodeSignature -LiteralPath $Msix
    if (-not $sig.SignerCertificate) {
        throw 'This package is not signed, so Windows will not install it outside the Microsoft Store. Download the signed OrderRestro.msix again.'
    }
    $cert = $sig.SignerCertificate

    # Only a self-signed publisher needs to be trusted by hand; a certificate
    # that already chains to a trusted authority installs as it is.
    $selfSigned = $cert.Subject -eq $cert.Issuer
    if ($selfSigned) {
        $already = Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
        if (-not $already) {
            Write-Host "Trusting the app certificate ($($cert.Subject)) for app installs..."
            $tmp = Join-Path $env:TEMP ('orderrestro-' + [guid]::NewGuid().ToString('N') + '.cer')
            Export-Certificate -Cert $cert -FilePath $tmp | Out-Null
            try { Import-Certificate -FilePath $tmp -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null }
            finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
        }
    }

    # The app window is WebView2. It ships with Windows 11 and current Windows 10.
    $wv2 = @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    ) | Where-Object { Test-Path $_ }
    if (-not $wv2) {
        Write-Warning 'Microsoft Edge WebView2 Runtime was not found. If OrderRestro opens blank, install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start the app again.'
    }

    Write-Host 'Installing OrderRestro (an existing install is updated, your data is kept)...'
    Add-AppxPackage -Path $Msix -ForceApplicationShutdown

    $pkg = Get-AppxPackage -Name '*OrderRestro*' | Select-Object -First 1
    if (-not $pkg) { throw 'The install finished but the app is not registered. Restart the PC and run this installer again.' }
    Write-Host "Installed: $($pkg.PackageFullName)" -ForegroundColor Green

    if (-not $NoLaunch) {
        Write-Host 'Opening OrderRestro. The very first start sets up the local database and can take several minutes - leave it open.'
        Start-Process "shell:AppsFolder\$($pkg.PackageFamilyName)!OrderRestro"
    }
    Wait-Exit 0
}
catch {
    Write-Host ''
    Write-Host "Install failed: $($_.Exception.Message)" -ForegroundColor Red
    $hr = '{0:X8}' -f $_.Exception.HResult
    Write-Host "Error code: 0x$hr"
    switch -Regex ($_.Exception.Message) {
        '0x800B010[9A]' { Write-Host 'Windows does not trust the package certificate. Run this installer as administrator (right-click > Run as administrator).' }
        '0x80073CF[39]' { Write-Host 'A different version is already installed. Uninstall OrderRestro from Settings > Apps, then run this installer again.' }
        '0x80073D02'    { Write-Host 'OrderRestro is running. Close it (also from the system tray) and run this installer again.' }
        '0x80073CFF'    { Write-Host 'Sideloading apps is turned off. In Settings > System > For developers (or Privacy & security > For developers) allow installing apps from outside the Store.' }
    }
    Wait-Exit 1
}
