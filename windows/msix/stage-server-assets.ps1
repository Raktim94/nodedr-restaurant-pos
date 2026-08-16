#Requires -Version 7.0
<#
.SYNOPSIS
  Builds the backend + web app and stages everything the embedded-server
  Windows client needs — Postgres, a portable Node.js runtime, the built
  NestJS backend, and the built Next.js web standalone output — into
  $StageDir\server\, ready for build-windows-msix.ps1 to fold into the
  .msix package. Windows-only (matches build-windows-msix.ps1's own
  constraint) — reference run is windows-msix.yml's windows-latest job.

.DESCRIPTION
  Backend: staged via `pnpm deploy --prod` (pnpm's own tool for a correct,
  self-contained production node_modules for one workspace package) — see
  the "Stage backend" section's own comment for why an earlier hand-copied
  mirror of apps/backend/Dockerfile's COPY list couldn't correctly resolve
  prisma's multi-level pnpm dependency graph. Web: still mirrors apps/web/
  Dockerfile's COPY layout directly, since that's just the already-
  self-contained Next.js standalone build output, not a raw pnpm tree.
  Either way, the result still contains pnpm's normal internal symlink
  structure (real NTFS reparse points, since this runs on Windows) —
  directory copies use dereference-copy.js via Copy-DirectoryRobust below,
  which follows those into their real target content, because makeappx.exe
  (the actual MSIX packer) cannot pack a source tree containing real
  reparse points at all (see Copy-DirectoryRobust's comment for why
  Copy-Item -Recurse, then robocopy, then fs.cpSync were each tried and
  replaced before landing on this).

.PARAMETER StageDir
  Output root — server assets land in $StageDir\server\...

.PARAMETER RepoRoot
  Monorepo root. Defaults to two directories up from this script
  (windows/msix/../..).

.PARAMETER DownloadCacheDir
  Where the portable Node.js/Postgres zips are downloaded to. Re-used
  across runs if already present (idempotent) — point this at a CI cache
  directory (actions/cache) to avoid re-downloading ~80MB every run.

.EXAMPLE
  ./stage-server-assets.ps1 -StageDir ./out/stage
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$StageDir,

    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,

    [string]$DownloadCacheDir = (Join-Path $PSScriptRoot 'out\download-cache')
)

$ErrorActionPreference = 'Stop'

# Pinned versions — see this script's commit message / PR for how these
# were chosen: theseus-rs/postgresql-binaries publishes portable, minimal
# (~45MB) Postgres builds as versioned GitHub Release assets (unlike EDB's
# own download page, which has no stable version-pinned URL — it requires
# scraping an HTML page whose top listed build is whatever is newest, not
# a chosen major version). Postgres 16.x specifically matches
# docker-compose.yml's `postgres:16-alpine`.
$NodeVersion = '22.23.2'
$NodeZipUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$PostgresVersion = '16.15.0'
$PostgresZipUrl = "https://github.com/theseus-rs/postgresql-binaries/releases/download/$PostgresVersion/postgresql-$PostgresVersion-x86_64-pc-windows-msvc.zip"

$serverDir = Join-Path $StageDir 'server'
$backendStage = Join-Path $serverDir 'backend'
$webStage = Join-Path $serverDir 'web'
$nodeStage = Join-Path $serverDir 'node'
$postgresStage = Join-Path $serverDir 'postgres'

Write-Host "== Staging embedded-server assets ==" -ForegroundColor Cyan
Write-Host "RepoRoot=$RepoRoot" -ForegroundColor Cyan
Write-Host "StageDir=$StageDir" -ForegroundColor Cyan

foreach ($tool in 'pnpm', 'node') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool not found on PATH. Run actions/setup-node + corepack enable first (see windows-msix.yml)."
    }
}

New-Item -ItemType Directory -Force -Path $serverDir, $DownloadCacheDir | Out-Null

# Enable Windows's native long-path support (registry, machine-wide) —
# the officially documented fix for MAX_PATH (260 chars), which a
# dereferenced pnpm tree exceeds easily (node_modules\.pnpm\node_modules\
# <pkg>\... chains get long fast). Tried \\?\ (extended-length path)
# prefixing instead first — it failed TWICE in different, seemingly
# unrelated ways (ERROR 53 "network path not found" on both a shallow
# reparse-point source AND, separately, a trivially short plain
# destination folder), which means this robocopy build just doesn't
# handle that prefix reliably here, not that path length itself was ever
# the wrong diagnosis. This is safe on a CI runner (fresh VM per job) —
# best-effort only for a local/non-admin run, where the copy still mostly
# works for paths under 260 chars regardless.
try {
    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1 -Type DWord -ErrorAction Stop
    Write-Host "Enabled Windows long-path support (registry)." -ForegroundColor DarkGray
} catch {
    Write-Host "Could not enable long-path support ($($_.Exception.Message)) — continuing; only matters for very deeply nested paths." -ForegroundColor Yellow
}

function Copy-DirectoryRobust {
    param([string]$Src, [string]$Dst, [switch]$Optional)
    # Copy-Item -Recurse mishandles NTFS junctions/symlinks — pnpm's
    # node_modules is full of them — and hit an Access Denied failure on a
    # runaway path. robocopy got much further (it does correctly
    # dereference the TOP-level source argument) but reliably failed with
    # ERROR 3 "path not found" on every node_modules\.pnpm\node_modules\*
    # entry — that directory is itself full of symlinks one level further
    # indirected (pnpm's own cross-package resolution links), which
    # robocopy seems unable to walk regardless of path length. Node's
    # fs.cpSync({dereference:true}) handled that fine but then crashed
    # (exit -1073740791 / STATUS_STACK_BUFFER_OVERRUN — a native stack
    # overflow in its recursive implementation) on apps/web/.next/
    # standalone specifically.
    #
    # dereference-copy.js (in this same directory) walks the tree
    # iteratively — an explicit work-stack, not recursive calls — so
    # there's no call-stack depth to overflow regardless of source
    # structure, with proper per-branch cycle detection.
    if (-not (Test-Path $Src)) {
        if ($Optional) {
            Write-Host "   (skipping optional copy — source doesn't exist: $Src)" -ForegroundColor DarkGray
            return
        }
        throw "Copy-DirectoryRobust: source does not exist: $Src"
    }
    New-Item -ItemType Directory -Force -Path $Dst | Out-Null
    $copyScript = Join-Path $PSScriptRoot 'dereference-copy.js'
    & node $copyScript (Resolve-Path $Src).Path $Dst
    if ($LASTEXITCODE -ne 0) {
        throw "dereference-copy.js failed copying '$Src' -> '$Dst' (exit code $LASTEXITCODE)"
    }
}

# --- 1. Install + build (full workspace, not --prod — see file header) -----
Push-Location $RepoRoot
try {
    Write-Host "-- pnpm install --frozen-lockfile" -ForegroundColor Yellow
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE" }

    Write-Host "-- Building @nodedr-restaurant/types" -ForegroundColor Yellow
    & pnpm --filter '@nodedr-restaurant/types' build
    if ($LASTEXITCODE -ne 0) { throw "types build failed with exit code $LASTEXITCODE" }

    # Runs ON windows-latest, so Prisma's "native" binaryTarget (no
    # override in schema.prisma) correctly resolves to the Windows query
    # engine — no schema change needed, just this execution order.
    Write-Host "-- prisma generate (Windows engine)" -ForegroundColor Yellow
    & pnpm --filter '@nodedr-restaurant/backend' exec prisma generate
    if ($LASTEXITCODE -ne 0) { throw "prisma generate failed with exit code $LASTEXITCODE" }

    Write-Host "-- Building backend" -ForegroundColor Yellow
    & pnpm --filter '@nodedr-restaurant/backend' build
    if ($LASTEXITCODE -ne 0) { throw "backend build failed with exit code $LASTEXITCODE" }

    Write-Host "-- Building web (standalone output)" -ForegroundColor Yellow
    # Deliberately NOT setting BACKEND_URL: the unmodified default
    # (http://localhost:4001) already matches ServerPaths.BackendPort — see
    # apps/web/next.config.ts. Same for NEXT_PUBLIC_WS_URL, which now
    # resolves from window.location.hostname at runtime instead of a
    # build-time value (see use-realtime.ts / notification-bell.tsx).
    & pnpm --filter web build
    if ($LASTEXITCODE -ne 0) { throw "web build failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

# --- 2. Stage backend via `pnpm deploy` -------------------------------------
# Hand-copying apps/backend/node_modules (mirroring the Dockerfile's own
# COPY list — the approach this replaces) repeatedly failed to correctly
# resolve prisma's multi-level dependency graph. pnpm's non-hoisted layout
# resolves EACH package's own dependencies through ITS OWN
# .pnpm/pkg@version/node_modules/ context — require('@prisma/engines')
# from prisma's own files resolves through ANOTHER such context nested
# inside @prisma/engines's own store folder, and so on recursively.
# Manually copying/guessing which nested contexts to preserve turned into
# an unwinnable one-missing-module-at-a-time chase (@prisma/engines, then
# @prisma/debug, then the unrelated `effect` package). Reclassifying
# `prisma` from a devDependency to a real dependency (see that
# package.json commit) was necessary but NOT sufficient on its own either
# — `pnpm prune --prod` at the workspace root still silently removed
# apps/backend/node_modules/prisma's symlink specifically (confirmed
# directly: the real content survived in the .pnpm store, only the
# symlink pointing to it got deleted), even though prisma is correctly
# classified as production in both package.json and the lockfile.
#
# `pnpm deploy` is pnpm's own purpose-built tool for producing a correct,
# complete, self-contained production node_modules for exactly this
# scenario (one workspace package, deployed standalone) — confirmed
# directly: its output runs prisma's CLI correctly with zero manual
# patching, sidestepping whatever exactly made in-place pruning misbehave
# by building a fresh node_modules from scratch instead. `--legacy` avoids
# needing an `inject-workspace-packages=true` pnpm-workspace.yaml change
# pnpm v10+ otherwise requires for deploy.
Write-Host "-- Staging backend (pnpm deploy --prod)" -ForegroundColor Yellow
$backendDeployTemp = Join-Path $StageDir '_backend_deploy_temp'
Remove-Item -Recurse -Force $backendDeployTemp, $backendStage -ErrorAction SilentlyContinue
Push-Location $RepoRoot
try {
    & pnpm --filter '@nodedr-restaurant/backend' deploy --prod --legacy $backendDeployTemp
    if ($LASTEXITCODE -ne 0) { throw "pnpm deploy failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

# Diagnostic: pin down (before any pruning/copying below could obscure it)
# whether `pnpm deploy` itself produced a resolvable @prisma/engines, since
# a prior CI run failed with "Cannot find module '@prisma/engines'" at the
# functional smoke test further down and it's not yet known whether the gap
# is at deploy time or in the later dereferencing copy.
Write-Host "-- Diagnostic: @prisma/engines presence right after pnpm deploy" -ForegroundColor DarkGray
$engineLinkPath = Join-Path $backendDeployTemp 'node_modules\@prisma\engines'
if (Test-Path $engineLinkPath) {
    $item = Get-Item $engineLinkPath -Force
    Write-Host "   node_modules\@prisma\engines exists (LinkType=$($item.LinkType))" -ForegroundColor DarkGray
    try {
        $resolved = (Resolve-Path $engineLinkPath).Path
        Write-Host "   resolves to: $resolved" -ForegroundColor DarkGray
        Write-Host "   entry count at resolved target: $((Get-ChildItem $resolved -Force -ErrorAction SilentlyContinue | Measure-Object).Count)" -ForegroundColor DarkGray
    } catch {
        Write-Host "   could not resolve target: $($_.Exception.Message)" -ForegroundColor DarkGray
    }
} else {
    Write-Host "   node_modules\@prisma\engines does NOT exist right after deploy." -ForegroundColor DarkGray
}
$pnpmDir = Join-Path $backendDeployTemp 'node_modules\.pnpm'
if (Test-Path $pnpmDir) {
    $engineStoreDirs = Get-ChildItem $pnpmDir -Directory -Filter '@prisma+engines@*' -ErrorAction SilentlyContinue
    Write-Host "   .pnpm store dirs matching @prisma+engines@*: $($engineStoreDirs.Count) -> $(($engineStoreDirs | Select-Object -ExpandProperty Name) -join ', ')" -ForegroundColor DarkGray
    $prismaStoreDirs = Get-ChildItem $pnpmDir -Directory -Filter 'prisma@*' -ErrorAction SilentlyContinue
    foreach ($p in $prismaStoreDirs) {
        $nestedEngineLink = Join-Path $p.FullName 'node_modules\@prisma\engines'
        Write-Host "   $($p.Name) -> node_modules\@prisma\engines exists: $(Test-Path $nestedEngineLink)" -ForegroundColor DarkGray
    }
} else {
    Write-Host "   node_modules\.pnpm does NOT exist right after deploy." -ForegroundColor DarkGray
}

# deploy doesn't include build output (dist/ is gitignored, and deploy
# follows the same file-inclusion rules as `npm pack`/publish) — copy the
# already-built dist/ in separately, before the dereferencing copy below.
Copy-Item -Path (Join-Path $RepoRoot 'apps\backend\dist') -Destination (Join-Path $backendDeployTemp 'dist') -Recurse -Force

# deploy copies the full package source tree (src/, test/, Dockerfile,
# README.md, .env.example, eslint config, tsconfig, etc.) — legitimate
# for a real deploy, but bloat/leak risk for a shipped MSIX and would trip
# validate-msix.ps1's dev-artifact checks. Keep only what's needed to run.
$keepTopLevel = @('node_modules', 'dist', 'prisma', 'package.json')
Get-ChildItem -Path $backendDeployTemp | Where-Object { $keepTopLevel -notcontains $_.Name } |
    Remove-Item -Recurse -Force

# Dereference into the real staging location: deploy's own node_modules
# still uses pnpm's normal internal .pnpm-store structure (real NTFS
# reparse points here, since this runs on Windows), which makeappx can't
# pack (see Copy-DirectoryRobust's comment) — note the output layout is
# FLAT (no more apps\backend\... nesting) since deploy's whole point is a
# standalone package root; ServerPaths.BackendWorkingDir matches this.
Copy-DirectoryRobust -Src $backendDeployTemp -Dst $backendStage
Remove-Item -Recurse -Force $backendDeployTemp

if (-not (Test-Path (Join-Path $backendStage 'dist\src\main.js'))) {
    throw "Backend staging looks wrong — dist\src\main.js not found under $backendStage"
}
$prismaCliPath = Join-Path $backendStage 'node_modules\prisma\build\index.js'
if (-not (Test-Path $prismaCliPath)) {
    throw "Backend staging looks wrong — prisma CLI not found under $backendStage\node_modules\prisma."
}
# Functional smoke test, not just file-existence: a missing transitive
# dependency (e.g. @prisma/engines, @prisma/debug, effect — real gaps hit
# with the hand-copying approach this replaced) wouldn't be caught by
# checking individual files exist, but would still break `prisma migrate
# deploy` at runtime. Actually exercises the CLI's own require() chain.
& node $prismaCliPath --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Backend staging looks wrong — the staged prisma CLI failed to even print --version (exit $LASTEXITCODE)."
}

# --- 3. Stage web, mirroring apps/web/Dockerfile's runtime COPYs -----------
Write-Host "-- Staging web" -ForegroundColor Yellow
Remove-Item -Recurse -Force $webStage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $webStage | Out-Null
$standaloneDir = Join-Path $RepoRoot 'apps\web\.next\standalone'
if (-not (Test-Path $standaloneDir)) { throw "apps\web\.next\standalone not found — did `pnpm --filter web build` actually run with output:'standalone' configured?" }
Copy-DirectoryRobust -Src $standaloneDir -Dst $webStage
New-Item -ItemType Directory -Force -Path (Join-Path $webStage 'apps\web') | Out-Null
Copy-DirectoryRobust -Src (Join-Path $RepoRoot 'apps\web\public') -Dst (Join-Path $webStage 'apps\web\public')
Copy-DirectoryRobust -Src (Join-Path $RepoRoot 'apps\web\.next\static') -Dst (Join-Path $webStage 'apps\web\.next\static')
if (-not (Test-Path (Join-Path $webStage 'apps\web\server.js'))) {
    throw "Web staging looks wrong — apps\web\server.js not found under $webStage"
}

# --- 4. Portable Node.js runtime -------------------------------------------
Write-Host "-- Staging portable Node.js runtime" -ForegroundColor Yellow
$nodeZip = Join-Path $DownloadCacheDir "node-v$NodeVersion-win-x64.zip"
if (-not (Test-Path $nodeZip)) {
    Write-Host "   Downloading $NodeZipUrl" -ForegroundColor DarkGray
    Invoke-WebRequest -Uri $NodeZipUrl -OutFile $nodeZip
}
$nodeExtractTemp = Join-Path $StageDir '_extract_node'
Remove-Item -Recurse -Force $nodeExtractTemp, $nodeStage -ErrorAction SilentlyContinue
Expand-Archive -Path $nodeZip -DestinationPath $nodeExtractTemp -Force
$nodeInner = Get-ChildItem $nodeExtractTemp -Directory | Select-Object -First 1
Move-Item -Path $nodeInner.FullName -Destination $nodeStage
Remove-Item -Recurse -Force $nodeExtractTemp
if (-not (Test-Path (Join-Path $nodeStage 'node.exe'))) {
    throw "Node.js staging looks wrong — node.exe not found under $nodeStage"
}

# --- 5. Portable Postgres binaries ------------------------------------------
Write-Host "-- Staging portable Postgres binaries" -ForegroundColor Yellow
$pgZip = Join-Path $DownloadCacheDir "postgresql-$PostgresVersion-windows-x64.zip"
if (-not (Test-Path $pgZip)) {
    Write-Host "   Downloading $PostgresZipUrl" -ForegroundColor DarkGray
    Invoke-WebRequest -Uri $PostgresZipUrl -OutFile $pgZip
}
$pgExtractTemp = Join-Path $StageDir '_extract_postgres'
Remove-Item -Recurse -Force $pgExtractTemp, $postgresStage -ErrorAction SilentlyContinue
Expand-Archive -Path $pgZip -DestinationPath $pgExtractTemp -Force
$pgInner = Get-ChildItem $pgExtractTemp -Directory | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $postgresStage | Out-Null
# Only bin/lib/share are needed at runtime — drop include/ (dev headers)
# and StackBuilder/ (GUI installer helper) to keep the package smaller.
foreach ($dir in 'bin', 'lib', 'share') {
    Copy-Item -Path (Join-Path $pgInner.FullName $dir) -Destination (Join-Path $postgresStage $dir) -Recurse -Force
}
Remove-Item -Recurse -Force $pgExtractTemp
if (-not (Test-Path (Join-Path $postgresStage 'bin\pg_ctl.exe'))) {
    throw "Postgres staging looks wrong — bin\pg_ctl.exe not found under $postgresStage"
}

# --- 6. Strip any stray .env-shaped files that leaked in ------------------
# pnpm's virtual store links each workspace package's node_modules entry
# back to its real source directory (that's how e.g. `require
# ('@nodedr-restaurant/types')` resolves at runtime) — dereferencing those
# via robocopy above pulls in whatever else lives in that source directory
# too, including apps/backend/.env.example (a template with no real
# secrets, but still not something that belongs in a shipped package).
# Deleting the actual symlink targets wholesale would risk breaking that
# resolution, so this sweeps the safer, narrower fix: remove any .env-
# shaped file, wherever it ended up.
Write-Host "-- Removing any stray .env-shaped files" -ForegroundColor Yellow
$strayEnvFiles = Get-ChildItem -Path $serverDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq '.env' -or $_.Name -like '.env.*' -or $_.Name -like '*.env' }
if ($strayEnvFiles) {
    Write-Host "   Removing $($strayEnvFiles.Count) file(s): $(($strayEnvFiles | Select-Object -First 5 -ExpandProperty Name) -join ', ')" -ForegroundColor DarkGray
    $strayEnvFiles | Remove-Item -Force
}

Write-Host "Done staging server assets at $serverDir" -ForegroundColor Green
