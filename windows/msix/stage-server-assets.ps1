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
  Mirrors apps/backend/Dockerfile and apps/web/Dockerfile's proven COPY
  layouts (directory structure), not the dependency-graph-based flattening
  `pnpm deploy` would do — see ServerPaths.cs's comment on BackendDir for
  why: pnpm's per-package node_modules/.bin/* entries are symlinks with
  relative paths back into the root node_modules/.pnpm store, and a wrong
  kind of flattening breaks them silently (npx then can't find the local
  `prisma` binary and fetches an arbitrary "latest" version instead).
  Directory copies use dereference-copy.js via Copy-DirectoryRobust below,
  which follows those same symlinks and copies their real target content
  — makeappx.exe (the actual MSIX packer) cannot pack a source tree
  containing real NTFS reparse points at all, so every file staged here
  ends up a real, ordinary file (see Copy-DirectoryRobust's comment for
  why Copy-Item -Recurse, then robocopy, then fs.cpSync were each tried
  and replaced before landing on this).

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
    param([string]$Src, [string]$Dst)
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
    if (-not (Test-Path $Src)) { throw "Copy-DirectoryRobust: source does not exist: $Src" }
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

    # Everything above needed the FULL (dev+prod) install — TypeScript,
    # @nestjs/cli, ESLint, Jest, Turbo, etc. are all devDependencies that
    # `next build`/`nest build` genuinely require. None of that is needed
    # to just RUN the built output, but it was staged wholesale in an
    # earlier version of this script and produced a package with over
    # 300,000 files — every workspace member's full devDependency tree,
    # multiplied by however many packages depend on each. Prune it now
    # that building is done, before anything gets copied for staging.
    #
    # `prisma` the CLI is the one devDependency actually needed at RUNTIME
    # (apps/backend/dist/src/main.js doesn't need it, but ServerSupervisor
    # separately runs `prisma migrate deploy` before starting it). The CLI
    # itself isn't self-contained — it needs its @prisma/* scope siblings
    # too (confirmed on real CI: pruning first, restoring only the
    # `prisma` folder, left `migrate deploy` failing with "Cannot find
    # module '@prisma/engines'" — that package is a dependency of the CLI
    # specifically, not of @prisma/client, so it isn't kept automatically
    # by @prisma/client's own real-dependency status surviving the prune).
    # A first attempt backed up/restored apps\backend\node_modules\@prisma
    # only — turns out @prisma/engines specifically is hoisted to the
    # ROOT node_modules\@prisma instead (apps\backend's own @prisma
    # folder exists but doesn't contain it), so both locations are backed
    # up/restored now. Save fully self-contained copies first
    # (Copy-DirectoryRobust dereferences pnpm's symlinks into real files,
    # so these survive the prune independent of whatever pnpm does to the
    # shared .pnpm store) — restoring @prisma/client's own already-kept
    # content again afterward is redundant but harmless, not incorrect.
    $prismaCliDir = Join-Path $RepoRoot 'apps\backend\node_modules\prisma'
    $prismaCliBackup = Join-Path $StageDir '_prisma_cli_backup'
    $prismaScopeDir = Join-Path $RepoRoot 'apps\backend\node_modules\@prisma'
    $prismaScopeBackup = Join-Path $StageDir '_prisma_scope_backup'
    $rootPrismaScopeDir = Join-Path $RepoRoot 'node_modules\@prisma'
    $rootPrismaScopeBackup = Join-Path $StageDir '_root_prisma_scope_backup'
    Write-Host "-- Preserving prisma CLI + @prisma/* (backend and root) before pruning devDependencies" -ForegroundColor Yellow
    Copy-DirectoryRobust -Src $prismaCliDir -Dst $prismaCliBackup
    Copy-DirectoryRobust -Src $prismaScopeDir -Dst $prismaScopeBackup
    Copy-DirectoryRobust -Src $rootPrismaScopeDir -Dst $rootPrismaScopeBackup

    Write-Host "-- Pruning devDependencies (keep only what's needed at runtime)" -ForegroundColor Yellow
    & pnpm prune --prod
    if ($LASTEXITCODE -ne 0) { throw "pnpm prune --prod failed with exit code $LASTEXITCODE" }

    Write-Host "-- Restoring prisma CLI + @prisma/*" -ForegroundColor Yellow
    Copy-DirectoryRobust -Src $prismaCliBackup -Dst $prismaCliDir
    Copy-DirectoryRobust -Src $prismaScopeBackup -Dst $prismaScopeDir
    Copy-DirectoryRobust -Src $rootPrismaScopeBackup -Dst $rootPrismaScopeDir
    # These scratch holding areas live under $StageDir, which
    # build-windows-msix.ps1 packs wholesale (`makeappx pack /d
    # $stageDir`) — left uncleaned, they ship inside the .msix too.
    Remove-Item -Recurse -Force $prismaCliBackup, $prismaScopeBackup, $rootPrismaScopeBackup -ErrorAction SilentlyContinue
}
finally {
    Pop-Location
}

# --- 2. Stage backend, mirroring apps/backend/Dockerfile's runtime COPYs ---
Write-Host "-- Staging backend" -ForegroundColor Yellow
Remove-Item -Recurse -Force $backendStage -ErrorAction SilentlyContinue
$copies = @(
    @{ Src = 'node_modules'; Dst = 'node_modules' }
    @{ Src = 'apps\backend\node_modules'; Dst = 'apps\backend\node_modules' }
    @{ Src = 'apps\backend\dist'; Dst = 'apps\backend\dist' }
    @{ Src = 'apps\backend\prisma'; Dst = 'apps\backend\prisma' }
    @{ Src = 'apps\backend\package.json'; Dst = 'apps\backend\package.json' }
    @{ Src = 'packages\types\dist'; Dst = 'packages\types\dist' }
    @{ Src = 'packages\types\package.json'; Dst = 'packages\types\package.json' }
    @{ Src = 'packages\types\node_modules'; Dst = 'packages\types\node_modules' }
)
foreach ($copy in $copies) {
    $src = Join-Path $RepoRoot $copy.Src
    $dst = Join-Path $backendStage $copy.Dst
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    if (Test-Path $src -PathType Container) {
        Copy-DirectoryRobust -Src $src -Dst $dst
    }
    elseif (Test-Path $src) {
        Copy-Item -Path $src -Destination $dst -Force
    }
    else {
        throw "Expected build output missing: $src (did the build steps above actually run?)"
    }
}
if (-not (Test-Path (Join-Path $backendStage 'apps\backend\dist\src\main.js'))) {
    throw "Backend staging looks wrong — apps\backend\dist\src\main.js not found under $backendStage"
}
$prismaEnginesInBackend = Test-Path (Join-Path $backendStage 'apps\backend\node_modules\@prisma\engines')
$prismaEnginesInRoot = Test-Path (Join-Path $backendStage 'node_modules\@prisma\engines')
if (-not $prismaEnginesInBackend -and -not $prismaEnginesInRoot) {
    throw "Backend staging looks wrong — @prisma\engines not found under either " +
          "$backendStage\apps\backend\node_modules\@prisma or $backendStage\node_modules\@prisma " +
          "(pnpm hoists it to the root node_modules, not apps/backend's own, confirmed on real CI). " +
          "This is a dependency of the prisma CLI specifically (not of @prisma/client), so it isn't kept " +
          "automatically by @prisma/client's own real-dependency status surviving pnpm prune --prod — " +
          "the @prisma scope backup/restore above must cover it explicitly."
}
# Functional smoke test, not just file-existence: a missing FURTHER
# transitive dependency wouldn't be caught by checking individual files
# exist, but would still break `prisma migrate deploy` at runtime exactly
# like the @prisma/engines gap this check is here to prevent a regression
# of. Actually exercises the CLI's own require() chain.
& node (Join-Path $backendStage 'apps\backend\node_modules\prisma\build\index.js') --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Backend staging looks wrong — the staged prisma CLI failed to even print --version (exit $LASTEXITCODE). " +
          "It's likely missing a further @prisma/* runtime dependency beyond what this script currently backs up."
}
if (-not (Test-Path (Join-Path $backendStage 'apps\backend\node_modules\prisma\build\index.js'))) {
    throw "Backend staging looks wrong — prisma CLI not found under $backendStage\apps\backend\node_modules\prisma. " +
          "It's a devDependency, so this requires the FULL `pnpm install` above, not a --prod install."
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
