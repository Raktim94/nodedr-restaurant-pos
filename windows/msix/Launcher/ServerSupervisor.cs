using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace OrderRestro.Launcher;

/// <summary>
/// Owns the lifecycle of the embedded server: Postgres, the NestJS
/// backend, and the Next.js web app, all run as native child processes of
/// this launcher (no Docker). Only used when the user chose "this is the
/// main computer" at first run (see MainForm's embedded-mode flow) —
/// otherwise the app stays a pure thin client pointed at someone else's
/// server, exactly as before this feature.
///
/// v1 scope: fixed ports (see ServerPaths), no Windows Service — these
/// processes live and die with this launcher's process tree. The launcher
/// itself minimizes to a tray icon instead of exiting on window close (see
/// TrayIcon.cs / MainForm.cs) so other LAN devices keep working as long as
/// this app keeps running in the background, not necessarily visible.
/// </summary>
internal sealed class ServerSupervisor : IDisposable
{
    public event Action<string>? StatusChanged;
    public event Action<string>? Faulted;

    private Process? _backend;
    private Process? _web;
    private bool _stopping;

    public async Task StartAsync(CancellationToken ct)
    {
        ServerPaths.EnsureDirectoriesExist();

        var firstRun = !File.Exists(ServerPaths.BackendEnvPath);

        LogStartup($"postgres bin dir: {ServerPaths.PostgresBinDir}");
        LogStartup($"postgres data dir: {ServerPaths.PgDataDir}");
        LogStartup($"postgres port: {ServerPaths.PostgresPort}");

        await EnsureRuntimeCopyAsync(ct);

        Report("Preparing local database…");
        await EnsurePostgresInitializedAsync(ct);
        await StartPostgresAsync(ct);
        await EnsureDatabaseCreatedAsync(ct);

        if (firstRun)
        {
            Report("Setting up for first run…");
            WriteBackendEnv();
        }

        Report("Running database migrations…");
        await RunMigrationsAsync(ct);

        Report("Starting server…");
        StartBackend();
        LogStartup("backend process started, waiting for health check");
        await WaitForHttpHealthAsync($"http://127.0.0.1:{ServerPaths.BackendPort}/api/health", TimeSpan.FromSeconds(45), ct);
        LogStartup("backend health check: OK");

        StartWeb();
        LogStartup("web process started, waiting for health check");
        await WaitForHttpHealthAsync($"http://127.0.0.1:{ServerPaths.WebPort}/api/health", TimeSpan.FromSeconds(45), ct);
        LogStartup("web health check: OK");

        Report("Ready.");
    }

    public async Task StopAsync()
    {
        _stopping = true;
        StopProcess(ref _web, "web");
        StopProcess(ref _backend, "backend");

        if (await GetPostgresStatusAsync(CancellationToken.None) == PostgresStatus.Running)
        {
            await RunToolAsync(
                Path.Combine(ServerPaths.PostgresBinDir, "pg_ctl.exe"),
                $"stop -D \"{ServerPaths.PgDataDir}\" -m fast -w",
                ServerPaths.PostgresBinDir,
                env: null,
                "pg_ctl-stop",
                CancellationToken.None);
        }
        _stopping = false;
    }

    // --- Runtime copy -------------------------------------------------------

    // MSIX install directories (C:\Program Files\WindowsApps\...) carry
    // restrictive ACLs that block spawning arbitrary bundled executables
    // as child processes, even for a runFullTrust app — confirmed on real
    // CI: initdb.exe failed with "Access is denied" trying to run
    // postgres.exe -V directly from the install location. Only the
    // package's own declared entry point (OrderRestro.exe itself) is
    // actually launchable in place. The standard fix: copy the runtime
    // payload to a writable location once, and execute everything from
    // there instead — see ServerPaths.RuntimeServerDir.
    private async Task EnsureRuntimeCopyAsync(CancellationToken ct)
    {
        // node.exe existing is the marker that a copy already completed —
        // skipped on every launch after the first (this is a one-time,
        // possibly slow — a few hundred MB — cost, not something to redo
        // on every start). Known v1 limitation: doesn't detect an MSIX
        // upgrade to a newer version and re-copy automatically; deleting
        // %LOCALAPPDATA%\OrderRestro\server\server-runtime forces a
        // fresh copy if ever needed.
        if (File.Exists(ServerPaths.NodeExePath)) return;

        // This build's package genuinely has no embedded-server payload —
        // either it was built without -IncludeEmbeddedServer (the default;
        // see build-windows-msix.ps1), or an OLDER thin-client-only build
        // got installed over a newer one. Without this check, robocopy
        // just fails on a missing source directory with a bare "exit 16"
        // — nothing here explains WHY, and config.json's Mode: embedded
        // (written by FirstRunChoiceForm) persists in %LOCALAPPDATA%
        // independently of whichever package is actually installed, so a
        // stale choice from an earlier embedded install can silently
        // outlive a later thin-client-only reinstall.
        if (!Directory.Exists(ServerPaths.InstallServerDir) || !Directory.EnumerateFileSystemEntries(ServerPaths.InstallServerDir).Any())
        {
            throw new InvalidOperationException(
                "This installed build does not include the embedded server (it was built without -IncludeEmbeddedServer), " +
                "but this PC is configured to run in embedded mode — likely left over from a previous install.\n\n" +
                $"Delete \"{AppConfig.ConfigPath}\" and relaunch to choose again, or reinstall using a package built with -IncludeEmbeddedServer.");
        }

        Report("Setting up (first launch only — this can take a minute)…");
        if (Directory.Exists(ServerPaths.RuntimeServerDir))
        {
            Directory.Delete(ServerPaths.RuntimeServerDir, recursive: true);
        }
        Directory.CreateDirectory(ServerPaths.RuntimeServerDir);

        // robocopy, not a hand-rolled copy loop: this source tree is the
        // final packaged/dereferenced output (see stage-server-assets.ps1)
        // with no symlinks left in it, so none of the reparse-point issues
        // that ruled out robocopy for STAGING apply here — a plain
        // real-file-to-real-file bulk copy is exactly what robocopy is
        // actually good at.
        var exitCode = await RunToolAsync(
            "robocopy.exe",
            $"\"{ServerPaths.InstallServerDir}\" \"{ServerPaths.RuntimeServerDir}\" /E /R:2 /W:2",
            workingDir: ServerPaths.DataDir,
            env: null,
            "runtime-copy",
            ct);
        // robocopy's exit codes are a bitmask where 0-7 are all "success"
        // variants (files copied / extra files present / etc.) — only 8+
        // means a real failure.
        if (exitCode >= 8)
        {
            throw new InvalidOperationException($"Could not copy the embedded server runtime to a writable location (robocopy exit {exitCode}) — see {ServerPaths.ServerLogDir}\\runtime-copy.log");
        }
    }

    // --- Postgres ---------------------------------------------------------

    private async Task EnsurePostgresInitializedAsync(CancellationToken ct)
    {
        var versionFile = Path.Combine(ServerPaths.PgDataDir, "PG_VERSION");
        if (File.Exists(versionFile))
        {
            // Existing database — never re-initialize it. Only verify it's
            // compatible with the Postgres binaries this build actually
            // ships, since a Microsoft Store update can bump the bundled
            // major version while a restaurant's existing data directory
            // stays on the old one. Postgres data files are NOT forward/
            // backward compatible across major versions — starting the new
            // binary against old-major data fails immediately, and running
            // initdb "to fix it" would destroy the existing database.
            await VerifyPostgresVersionCompatibleAsync(versionFile, ct);
            return;
        }

        Directory.CreateDirectory(ServerPaths.PgDataDir);
        var pwFile = Path.Combine(Path.GetTempPath(), $"orderrestro-pg-{Guid.NewGuid():N}.txt");
        // Trust auth is fine here: Postgres is bound to 127.0.0.1 only,
        // never exposed to the LAN (same reasoning docker-compose.yml
        // already documents for its own `postgres` service) — the
        // password in the connection string exists only to satisfy
        // Prisma's URL format, not for real access control.
        File.WriteAllText(pwFile, "embedded");
        try
        {
            var exit = await RunToolAsync(
                Path.Combine(ServerPaths.PostgresBinDir, "initdb.exe"),
                $"-D \"{ServerPaths.PgDataDir}\" -U orderrestro -A trust -E UTF8 --pwfile=\"{pwFile}\"",
                ServerPaths.PostgresBinDir,
                env: null,
                "initdb",
                ct);
            if (exit != 0) throw new InvalidOperationException($"initdb failed with exit code {exit} — see {ServerPaths.ServerLogDir}");
        }
        finally
        {
            File.Delete(pwFile);
        }
    }

    private enum PostgresStatus
    {
        /// <summary>pg_ctl status confirmed a live postmaster for OUR OWN data directory.</summary>
        Running,

        /// <summary>
        /// No live postmaster for this data directory. If postmaster.pid is
        /// left over from an unclean shutdown (Task Manager kill, forced
        /// Windows restart), pg_ctl's own startup logic — not us — decides
        /// it's stale and cleans it up; we never delete postmaster.pid
        /// ourselves.
        /// </summary>
        NotRunning,

        /// <summary>
        /// The data directory itself couldn't be read (missing/corrupted/
        /// permissions) — distinct from NotRunning so callers don't treat a
        /// broken data directory as a plain "not started yet."
        /// </summary>
        DataDirInaccessible,
    }

    /// <summary>
    /// pg_ctl status is Postgres's own authoritative answer to "is a
    /// postmaster running for this data directory" — it reads
    /// postmaster.pid and verifies the recorded PID is genuinely alive
    /// using the platform's own liveness primitives, which is far more
    /// reliable than reimplementing that check by hand: Windows recycles
    /// PIDs fast enough that a bare "does a process with this PID exist"
    /// test is a real false-positive risk. This also answers "does the
    /// running instance actually belong to OrderRestro" for free, since it
    /// inspects OUR data directory specifically — unlike a raw TCP connect
    /// to the port, which would report "running" for ANY process that
    /// happens to be listening there, ours or not.
    /// </summary>
    private async Task<PostgresStatus> GetPostgresStatusAsync(CancellationToken ct)
    {
        var exitCode = await RunToolAsync(
            Path.Combine(ServerPaths.PostgresBinDir, "pg_ctl.exe"),
            $"status -D \"{ServerPaths.PgDataDir}\"",
            ServerPaths.PostgresBinDir,
            env: null,
            "pg_ctl-status",
            ct);
        // Documented pg_ctl exit codes: 0 = running, 3 = not running (data
        // dir readable), 4 = data directory not accessible.
        return exitCode switch
        {
            0 => PostgresStatus.Running,
            3 => PostgresStatus.NotRunning,
            _ => PostgresStatus.DataDirInaccessible,
        };
    }

    private async Task VerifyPostgresVersionCompatibleAsync(string versionFilePath, CancellationToken ct)
    {
        var dataDirMajor = (await File.ReadAllTextAsync(versionFilePath, ct)).Trim();
        var bundledMajor = await GetBundledPostgresMajorVersionAsync(ct);
        LogStartup($"postgres version check: data dir={dataDirMajor}, bundled={bundledMajor}");
        if (dataDirMajor == bundledMajor) return;

        throw new InvalidOperationException(
            $"This update includes a newer PostgreSQL version (major {bundledMajor}) than the one your existing " +
            $"database was created with (major {dataDirMajor}).\n\n" +
            "Your restaurant data has NOT been touched or deleted. Automatic upgrades between major PostgreSQL " +
            "versions aren't supported yet — please contact support, or reinstall the previous OrderRestro " +
            "version to keep using your existing data until an upgrade path is available.");
    }

    private async Task<string> GetBundledPostgresMajorVersionAsync(CancellationToken ct)
    {
        var (exitCode, stdout, _) = await RunToolCapturedAsync(
            Path.Combine(ServerPaths.PostgresBinDir, "pg_ctl.exe"),
            "-V",
            ServerPaths.PostgresBinDir,
            env: null,
            "pg_ctl-version",
            ct);
        // Expected format: "pg_ctl (PostgreSQL) 16.15" -> "16".
        var match = Regex.Match(stdout, @"(\d+)(?:\.\d+)*");
        if (exitCode != 0 || !match.Success)
        {
            throw new InvalidOperationException("Could not determine the bundled PostgreSQL version (pg_ctl -V failed).");
        }
        return match.Groups[1].Value;
    }

    private async Task StartPostgresAsync(CancellationToken ct)
    {
        var status = await GetPostgresStatusAsync(ct);
        LogStartup($"existing postgres process detection: {status}");
        if (status == PostgresStatus.Running)
        {
            // Genuinely OrderRestro's own Postgres (confirmed against our
            // data directory, not just "something answers on the port")
            // from a prior launch that wasn't stopped cleanly. Reuse it
            // instead of starting a second instance.
            return;
        }

        var logPath = Path.Combine(ServerPaths.ServerLogDir, "postgres.log");
        var opts = $"-p {ServerPaths.PostgresPort} -c listen_addresses=127.0.0.1";
        var startArgs = $"start -D \"{ServerPaths.PgDataDir}\" -l \"{logPath}\" -w -t 30 -o \"{opts}\"";
        LogStartup($"starting postgres: pg_ctl {startArgs}");
        // RunDetachedToolAsync, not RunToolAsync: pg_ctl spawns postgres.exe
        // (a long-running detached child) — see that method's comment for
        // why redirecting output here hangs forever instead of returning
        // once pg_ctl's own -w/-t 30 wait completes.
        var exit = await RunDetachedToolAsync(
            Path.Combine(ServerPaths.PostgresBinDir, "pg_ctl.exe"),
            startArgs,
            ServerPaths.PostgresBinDir,
            ct);
        LogStartup($"pg_ctl start exit code: {exit}");
        if (exit != 0)
        {
            throw new InvalidOperationException(DiagnosePostgresFailure(logPath));
        }
    }

    /// <summary>
    /// Best-effort classification of the most common real pg_ctl start
    /// failures from postgres.log's own tail, so the error at least points
    /// somewhere useful instead of a bare "did not start." The raw tail is
    /// always included too — these patterns are not guaranteed to cover
    /// every real cause, and the full log stays available at logPath
    /// regardless (never hidden behind just this summary).
    /// </summary>
    private static string DiagnosePostgresFailure(string logPath)
    {
        string tail;
        try
        {
            var lines = File.Exists(logPath) ? File.ReadAllLines(logPath) : Array.Empty<string>();
            tail = string.Join(Environment.NewLine, lines.TakeLast(15));
        }
        catch
        {
            tail = "(could not read postgres.log)";
        }

        string headline = tail switch
        {
            _ when tail.Contains("Address already in use", StringComparison.OrdinalIgnoreCase)
                || tail.Contains("bind(", StringComparison.OrdinalIgnoreCase) =>
                $"Port {ServerPaths.PostgresPort} is already in use by another program on this PC.",
            _ when tail.Contains("Permission denied", StringComparison.OrdinalIgnoreCase)
                || tail.Contains("Access is denied", StringComparison.OrdinalIgnoreCase) =>
                "OrderRestro doesn't have permission to access its local database files.",
            _ when tail.Contains("database files are incompatible", StringComparison.OrdinalIgnoreCase) =>
                "The local database files are incompatible with this PostgreSQL version.",
            _ when tail.Length == 0 =>
                "PostgreSQL did not start, and produced no log output — this may be an interrupted or corrupted database.",
            _ => "PostgreSQL did not start.",
        };

        return tail.Length == 0
            ? $"{headline}\n\nSee {logPath} for details."
            : $"{headline}\n\nSee {logPath} for the full technical log. Last lines:\n{tail}";
    }

    private async Task EnsureDatabaseCreatedAsync(CancellationToken ct)
    {
        // Idempotent: createdb fails harmlessly if "orderrestro" already
        // exists (checked by exit code / stderr rather than treated as fatal).
        // Scoped timeout (not just the overall StartAsync budget): a hang
        // here previously burned the entire 15-minute outer budget with no
        // way to tell which step was actually stuck — see WithTimeoutAsync.
        var (exitCode, _, stderr) = await WithTimeoutAsync(ct, TimeSpan.FromSeconds(30), "createdb", innerCt =>
            RunToolCapturedAsync(
                Path.Combine(ServerPaths.PostgresBinDir, "createdb.exe"),
                "-U orderrestro -h 127.0.0.1 -p " + ServerPaths.PostgresPort + " orderrestro",
                ServerPaths.PostgresBinDir,
                env: null,
                "createdb",
                innerCt));
        if (exitCode != 0 && !stderr.Contains("already exists", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Could not create the database: {stderr}");
        }
    }

    // --- First-run secrets / config ----------------------------------------

    private void WriteBackendEnv()
    {
        var jwtSecret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)); // 64 hex chars, well over the 32-char minimum main.ts enforces
        var lines = new[]
        {
            $"JWT_SECRET={jwtSecret}",
            $"DATABASE_URL=postgresql://orderrestro:embedded@127.0.0.1:{ServerPaths.PostgresPort}/orderrestro",
            $"PORT={ServerPaths.BackendPort}",
            $"CORS_ORIGIN=http://localhost:{ServerPaths.WebPort}",
            $"COOKIE_SECURE=false",
            $"UPLOADS_DIR={ServerPaths.UploadsDir}",
            $"NODE_ENV=production",
        };
        File.WriteAllLines(ServerPaths.BackendEnvPath, lines, Encoding.UTF8);
    }

    private Dictionary<string, string> ReadBackendEnv()
    {
        var env = new Dictionary<string, string>();
        foreach (var line in File.ReadAllLines(ServerPaths.BackendEnvPath))
        {
            var idx = line.IndexOf('=');
            if (idx <= 0) continue;
            env[line[..idx]] = line[(idx + 1)..];
        }
        return env;
    }

    // --- Backend ------------------------------------------------------------

    private async Task RunMigrationsAsync(CancellationToken ct)
    {
        var env = ReadBackendEnv();
        var prismaCli = Path.Combine(ServerPaths.BackendWorkingDir, ServerPaths.BackendPrismaCliRelativePath);
        var exit = await WithTimeoutAsync(ct, TimeSpan.FromMinutes(2), "prisma migrate deploy", innerCt =>
            RunToolAsync(
                ServerPaths.NodeExePath,
                $"\"{prismaCli}\" migrate deploy",
                ServerPaths.BackendWorkingDir,
                env,
                "migrate",
                innerCt));
        if (exit != 0)
        {
            throw new InvalidOperationException($"Database migration failed (exit {exit}) — see {ServerPaths.ServerLogDir}");
        }
    }

    private void StartBackend()
    {
        var env = ReadBackendEnv();
        var mainJs = Path.Combine(ServerPaths.BackendWorkingDir, ServerPaths.BackendMainJsRelativePath);
        _backend = StartLongRunning(ServerPaths.NodeExePath, $"\"{mainJs}\"", ServerPaths.BackendWorkingDir, env, "backend");
    }

    private void StartWeb()
    {
        var env = new Dictionary<string, string>
        {
            ["PORT"] = ServerPaths.WebPort.ToString(),
            // 0.0.0.0, not localhost: other LAN devices' browsers need to
            // reach this port directly — that's the whole point.
            ["HOSTNAME"] = "0.0.0.0",
        };
        _web = StartLongRunning(ServerPaths.NodeExePath, $"\"{ServerPaths.WebServerScriptRelativePath}\"", ServerPaths.WebDir, env, "web");
    }

    private Process StartLongRunning(string exe, string args, string workingDir, Dictionary<string, string> env, string logName)
    {
        var psi = BuildStartInfo(exe, args, workingDir, env);
        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };

        var logPath = Path.Combine(ServerPaths.ServerLogDir, $"{logName}.log");
        StreamWriter logWriter;
        try
        {
            logWriter = new StreamWriter(File.Open(logPath, FileMode.Create, FileAccess.Write, FileShare.Read)) { AutoFlush = true };
        }
        catch (IOException ex)
        {
            // Program.cs's single-instance mutex should make this
            // unreachable in normal operation — a second launch never gets
            // far enough to call StartAsync at all. This is a defense-in-
            // depth diagnostic for whatever else could still hold the
            // handle (antivirus/backup software scanning the log, a prior
            // instance still inside its own StopAsync shutdown window) so
            // the failure reads as actionable instead of a bare Win32
            // "being used by another process" with no context.
            throw new InvalidOperationException(
                $"Could not open {logPath} — it's in use by another process. If OrderRestro is " +
                "already running, check the system tray (it minimizes there instead of exiting) " +
                $"before reopening it.\n\n({ex.Message})", ex);
        }
        proc.OutputDataReceived += (_, e) => { if (e.Data is not null) logWriter.WriteLine(e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data is not null) logWriter.WriteLine(e.Data); };
        proc.Exited += (_, _) =>
        {
            logWriter.Dispose();
            if (!_stopping)
            {
                Faulted?.Invoke($"The {logName} process stopped unexpectedly. See {logPath} for details.");
            }
        };

        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        return proc;
    }

    private void StopProcess(ref Process? proc, string name)
    {
        if (proc is null) return;
        try
        {
            if (!proc.HasExited)
            {
                proc.Kill(entireProcessTree: true);
                proc.WaitForExit(5000);
            }
        }
        catch
        {
            // best-effort shutdown
        }
        finally
        {
            proc.Dispose();
            proc = null;
        }
    }

    // --- Process/health helpers ---------------------------------------------

    // Bounds an individual step to its own timeout instead of relying on
    // the overall StartAsync budget — a hang here previously burned the
    // entire outer timeout (minutes) with the only symptom being "backend
    // never became healthy" and no way to tell which specific step never
    // finished. Distinguishes an inner timeout (this helper's own
    // CancelAfter firing) from the caller's own cancellation, so the
    // resulting error message is actually attributable.
    private static async Task<T> WithTimeoutAsync<T>(
        CancellationToken ct, TimeSpan timeout, string label, Func<CancellationToken, Task<T>> action)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        try
        {
            return await action(cts.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new TimeoutException($"{label} did not complete within {timeout.TotalSeconds:0}s.");
        }
    }

    private static ProcessStartInfo BuildStartInfo(string exe, string args, string workingDir, Dictionary<string, string>? env)
    {
        var psi = new ProcessStartInfo
        {
            FileName = exe,
            Arguments = args,
            WorkingDirectory = workingDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        if (env is not null)
        {
            foreach (var (key, value) in env) psi.EnvironmentVariables[key] = value;
        }
        return psi;
    }

    // Redirecting stdout/stderr without draining both concurrently risks a
    // deadlock the moment either OS pipe buffer fills (a few KB is enough)
    // — the child blocks writing, we're blocked waiting for it to exit.
    // Both streams are always read out in full before WaitForExitAsync.
    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunToolCapturedAsync(
        string exe, string args, string workingDir, Dictionary<string, string>? env, string logName, CancellationToken ct)
    {
        var psi = BuildStartInfo(exe, args, workingDir, env);
        using var proc = Process.Start(psi)!;
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        await Task.WhenAll(stdoutTask, stderrTask);
        await proc.WaitForExitAsync(ct);

        var logPath = Path.Combine(ServerPaths.ServerLogDir, $"{logName}.log");
        try
        {
            File.WriteAllText(logPath, stdoutTask.Result + Environment.NewLine + stderrTask.Result);
        }
        catch
        {
            // logging is best-effort
        }
        return (proc.ExitCode, stdoutTask.Result, stderrTask.Result);
    }

    private static async Task<int> RunToolAsync(string exe, string args, string workingDir, Dictionary<string, string>? env, string logName, CancellationToken ct)
    {
        var (exitCode, _, _) = await RunToolCapturedAsync(exe, args, workingDir, env, logName, ct);
        return exitCode;
    }

    // For a command that spawns a genuinely long-running DETACHED child
    // (specifically pg_ctl start, whose whole job is to launch postgres.exe
    // and then exit once it's confirmed ready) — NOT redirected, unlike
    // RunToolCapturedAsync/RunToolAsync above. Redirected stdout/stderr
    // pipe handles are inherited by default into any child THAT child
    // process spawns; postgres.exe never closes them (it's a server, not a
    // one-shot tool), so ReadToEndAsync on that pipe blocks forever even
    // after pg_ctl.exe itself has long since exited — confirmed on real
    // CI: pg_ctl start (with its own -w -t 30 timeout) returned instantly,
    // but the C# call reading its output hung for the full 15-minute
    // outer budget waiting for EOF that postgres.exe's still-open handle
    // was never going to produce. No log content is lost by not
    // redirecting here — pg_ctl start's own -l flag already writes
    // postgres's real diagnostic output to postgres.log directly.
    private static async Task<int> RunDetachedToolAsync(string exe, string args, string workingDir, CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName = exe,
            Arguments = args,
            WorkingDirectory = workingDir,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var proc = Process.Start(psi)!;
        await proc.WaitForExitAsync(ct);
        return proc.ExitCode;
    }

    private async Task WaitForHttpHealthAsync(string url, TimeSpan timeout, CancellationToken ct)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        var deadline = DateTime.UtcNow + timeout;
        Exception? lastError = null;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using var response = await client.GetAsync(url, ct);
                if (response.IsSuccessStatusCode) return;
            }
            catch (Exception ex)
            {
                lastError = ex;
            }
            await Task.Delay(500, ct);
        }
        throw new TimeoutException($"{url} did not become healthy in time.", lastError);
    }

    private void Report(string message) => StatusChanged?.Invoke(message);

    /// <summary>
    /// Structured, append-only startup log distinct from supervisor-error.log
    /// (that one only captures a fatal exception; this one captures the
    /// step-by-step lifecycle so a non-fatal but confusing run — e.g.
    /// "reused an existing Postgres instance" — is still diagnosable
    /// afterward). Never pass secrets here — DATABASE_URL/JWT_SECRET must
    /// never appear in this file.
    /// </summary>
    private static void LogStartup(string message)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(ServerPaths.ServerLogDir, "startup.log"),
                $"{DateTime.UtcNow:O} {message}{Environment.NewLine}");
        }
        catch
        {
            // best-effort, same as supervisor-error.log
        }
    }

    public void Dispose()
    {
        StopProcess(ref _web, "web");
        StopProcess(ref _backend, "backend");
    }
}
