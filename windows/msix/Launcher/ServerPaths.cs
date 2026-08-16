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
    /// windows/msix/stage-server-assets.ps1) — never written to at
    /// runtime, only read from. Resolved relative to the running exe's
    /// directory so it works both from an installed MSIX location and a
    /// local unpackaged test run.
    /// </summary>
    public static string InstallServerDir =>
        Path.Combine(AppContext.BaseDirectory, "server");

    public static string PostgresBinDir => Path.Combine(InstallServerDir, "postgres", "bin");

    // BackendDir is the staged equivalent of the monorepo ROOT (matches
    // apps/backend/Dockerfile's /repo), not a flattened single-package
    // folder — pnpm's per-package node_modules/.bin/* entries are symlinks
    // with RELATIVE paths back into the root node_modules/.pnpm store (see
    // that Dockerfile's own comment: flattening breaks them silently and
    // `npx` falls back to fetching an arbitrary "latest" package instead of
    // the local one). stage-server-assets.ps1 mirrors the Dockerfile's
    // exact COPY layout rooted here instead of flattening via `pnpm deploy`.
    public static string BackendDir => Path.Combine(InstallServerDir, "backend");

    // Working directory for node.exe when running the backend — matches
    // the Dockerfile's `WORKDIR /repo/apps/backend` before its CMD.
    public static string BackendWorkingDir => Path.Combine(BackendDir, "apps", "backend");
    public static string BackendMainJsRelativePath => Path.Combine("dist", "src", "main.js");
    public static string BackendPrismaCliRelativePath => Path.Combine("node_modules", "prisma", "build", "index.js");

    // The staged Next.js standalone output keeps its original monorepo-
    // relative layout (apps/web/server.js, apps/web/public, apps/web/.next)
    // — same structure apps/web/Dockerfile's runtime stage copies and the
    // same `node apps/web/server.js` invocation it uses, run with this
    // directory as the working directory, so this embedded path behaves
    // identically to the already-proven Docker deployment.
    public static string WebDir => Path.Combine(InstallServerDir, "web");
    public static string WebServerScriptRelativePath => Path.Combine("apps", "web", "server.js");

    // Portable Node.js runtime staged at build time — the target Windows
    // machine is not assumed to have Node.js installed.
    public static string NodeExePath => Path.Combine(InstallServerDir, "node", "node.exe");

    public static void EnsureDirectoriesExist()
    {
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(UploadsDir);
        Directory.CreateDirectory(ServerLogDir);
    }
}
