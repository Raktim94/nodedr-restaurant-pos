namespace OrderRestro.Launcher;

/// <summary>
/// Single source of truth for where the embedded server's writable state
/// lives (%LOCALAPPDATA%\OrderRestro\server\...) and where its read-only
/// runtime assets ship inside the MSIX install directory. Mirrors
/// AppConfig's existing ConfigDir pattern — writable state never goes
/// inside the install directory (read-only after install, not guaranteed
/// stable across updates).
/// </summary>
internal static class ServerPaths
{
    // Fixed ports for v1 — no dynamic discovery/conflict resolution.
    // Backend/web match the existing docker-compose deployment's own
    // defaults (backend 4001 per apps/web's next.config.ts default
    // BACKEND_URL, web 1995 per docker-compose.yml's HOST_PORT default) so
    // the already-built web standalone output needs no rebuild to work
    // with the embedded backend.
    public const int PostgresPort = 55432;
    public const int BackendPort = 4001;
    public const int WebPort = 1995;

    public static string DataDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OrderRestro", "server");

    public static string PgDataDir => Path.Combine(DataDir, "pgdata");
    public static string UploadsDir => Path.Combine(DataDir, "uploads");
    public static string ServerLogDir => Path.Combine(DataDir, "logs");
    public static string BackendEnvPath => Path.Combine(DataDir, "backend.env");
    public static string PgPasswordFilePath => Path.Combine(DataDir, "pg-password.txt");

    /// <summary>
    /// Read-only runtime assets staged into the MSIX at build time (see
    /// windows/msix/stage-server-assets.ps1). Resolved relative to the
    /// running exe's directory so it works both from an installed MSIX
    /// location and a local unpackaged test run.
    ///
    /// NEVER executed from directly — see RuntimeServerDir. MSIX install
    /// directories (C:\Program Files\WindowsApps\...) carry restrictive
    /// ACLs that block spawning arbitrary bundled executables as child
    /// processes even for a runFullTrust app (confirmed: initdb.exe
    /// failed with "Access is denied" trying to run postgres.exe -V from
    /// there) — only the package's own declared entry point (OrderRestro
    /// .exe itself) is actually launchable in place.
    /// </summary>
    public static string InstallServerDir =>
        Path.Combine(AppContext.BaseDirectory, "server");

    /// <summary>
    /// Writable copy of InstallServerDir under %LOCALAPPDATA%, made once
    /// on first run (see ServerSupervisor.EnsureRuntimeCopyAsync) — this
    /// is what actually gets executed from. Everything below derives
    /// paths from here, not InstallServerDir.
    /// </summary>
    public static string RuntimeServerDir => Path.Combine(DataDir, "server-runtime");

    public static string PostgresBinDir => Path.Combine(RuntimeServerDir, "postgres", "bin");

    // BackendDir is a FLAT, standalone package root — stage-server-assets.ps1
    // stages it via `pnpm deploy --prod` (pnpm's own tool for producing a
    // correct, self-contained production node_modules for one workspace
    // package), not a hand-copied mirror of the monorepo's directory
    // structure. An earlier version of this mirrored apps/backend/
    // Dockerfile's COPY layout by hand instead (BackendDir as the staged
    // monorepo root, BackendWorkingDir nested at apps\backend under it) —
    // switched because hand-copying couldn't correctly resolve prisma's
    // multi-level pnpm dependency graph (see that script's own comment for
    // the full story). BackendWorkingDir is now just BackendDir itself.
    public static string BackendDir => Path.Combine(RuntimeServerDir, "backend");
    public static string BackendWorkingDir => BackendDir;
    public static string BackendMainJsRelativePath => Path.Combine("dist", "src", "main.js");
    public static string BackendPrismaCliRelativePath => Path.Combine("node_modules", "prisma", "build", "index.js");

    // The staged Next.js standalone output keeps its original monorepo-
    // relative layout (apps/web/server.js, apps/web/public, apps/web/.next)
    // — same structure apps/web/Dockerfile's runtime stage copies and the
    // same `node apps/web/server.js` invocation it uses, run with this
    // directory as the working directory, so this embedded path behaves
    // identically to the already-proven Docker deployment.
    public static string WebDir => Path.Combine(RuntimeServerDir, "web");
    public static string WebServerScriptRelativePath => Path.Combine("apps", "web", "server.js");

    // Portable Node.js runtime staged at build time — the target Windows
    // machine is not assumed to have Node.js installed.
    public static string NodeExePath => Path.Combine(RuntimeServerDir, "node", "node.exe");

    public static void EnsureDirectoriesExist()
    {
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(UploadsDir);
        Directory.CreateDirectory(ServerLogDir);
    }
}
