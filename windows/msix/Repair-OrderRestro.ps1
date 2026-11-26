<#
.SYNOPSIS
  Rebuilds OrderRestro's program files on this PC. Your restaurant data is kept.

.DESCRIPTION
  Use this when OrderRestro opens to a blank window or stays on "Starting the backend".

  OrderRestro keeps two separate things on the PC:
    * its program files (a working copy of the server: Node, PostgreSQL programs, backend, web app) in
      ...\OrderRestro\server\server-runtime   <- this script deletes and rebuilds ONLY this
    * your data: the database (pgdata), uploaded files (uploads), settings (config.json, backend.env,
      pg-password.txt)   <- this script never reads, moves or deletes any of it

  Steps: close OrderRestro, stop its database cleanly, delete the program-files copy, and mark the next start
  to check every file. Then open OrderRestro again: it recreates the copy from the installed package (a few minutes).

  Usually started through Repair-OrderRestro.cmd (double-click). Needs no administrator rights.
#>
[CmdletBinding()]
param([switch]$NoPause)

$ErrorActionPreference = 'Stop'

function Wait-Exit([int]$code) {
    if (-not $NoPause) { Write-Host ''; Read-Host 'Press Enter to close' | Out-Null }
    exit $code
}

try {
    # Windows may keep an app's files under its own package folder instead of %LOCALAPPDATA%\OrderRestro.
    $roots = @(Join-Path $env:LOCALAPPDATA 'OrderRestro\server')
    $pkgRoot = Join-Path $env:LOCALAPPDATA 'Packages'
    if (Test-Path $pkgRoot) {
        $roots += Get-ChildItem $pkgRoot -Directory -Filter '*OrderRestro*' -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'LocalCache\Local\OrderRestro\server' }
    }
    $roots = $roots | Where-Object { (Test-Path (Join-Path $_ 'pgdata')) -or (Test-Path (Join-Path $_ 'server-runtime')) } | Select-Object -Unique
    if (-not $roots) { throw 'OrderRestro has not been started on this PC yet, so there is nothing to repair.' }

    Write-Host 'Closing OrderRestro...'
    Get-Process -Name 'OrderRestro' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2

    foreach ($root in $roots) {
        $runtime = Join-Path $root 'server-runtime'
        $pgData = Join-Path $root 'pgdata'
        Write-Host "Data folder: $root"
        if (Test-Path $pgData) { Write-Host '  database (pgdata): found - will not be touched' }
        if (Test-Path (Join-Path $root 'uploads')) { Write-Host '  uploaded files (uploads): found - will not be touched' }

        # Stop the database through its own tool so it shuts down cleanly, then anything still running from the copy.
        $pgCtl = Join-Path $runtime 'postgres\bin\pg_ctl.exe'
        if ((Test-Path $pgCtl) -and (Test-Path $pgData)) {
            Write-Host '  stopping the database...'
            & $pgCtl stop -D $pgData -m fast -w -t 30 2>&1 | Out-Null
        }
        Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -and $_.Path.StartsWith($runtime, [StringComparison]::OrdinalIgnoreCase) } |
            Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2

        if (Test-Path $runtime) {
            Write-Host '  deleting the program-files copy (server-runtime)...'
            # cmd's rd handles paths past 260 characters, which PowerShell's Remove-Item can trip over.
            & cmd.exe /c rd /s /q "\\?\$runtime" 2>&1 | Out-Null
            if (Test-Path $runtime) { throw "Could not delete $runtime. Restart the PC and run this repair again before opening OrderRestro." }
        }
        Remove-Item (Join-Path $root 'runtime.version') -Force -ErrorAction SilentlyContinue
        Set-Content -Path (Join-Path $root 'repair-requested.flag') -Value (Get-Date -Format o)
    }

    Write-Host ''
    Write-Host 'Done. Open OrderRestro now. The first start rebuilds the program files (2 to 5 minutes);' -ForegroundColor Green
    Write-Host 'leave the window open. Your database, restaurant records and uploaded files were not touched.' -ForegroundColor Green
    Wait-Exit 0
}
catch {
    Write-Host ''
    Write-Host "Repair failed: $($_.Exception.Message)" -ForegroundColor Red
    Wait-Exit 1
}
