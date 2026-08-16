using System.Diagnostics;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;

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
        await WaitForHttpHealthAsync($"http://127.0.0.1:{ServerPaths.BackendPort}/api/health", TimeSpan.FromSeconds(45), ct);

        StartWeb();
        await WaitForHttpHealthAsync($"http://127.0.0.1:{ServerPaths.WebPort}/api/health", TimeSpan.FromSeconds(45), ct);

        Report("Ready.");
    }

    public async Task StopAsync()
    {
        _stopping = true;
        StopProcess(ref _web, "web");
        StopProcess(ref _backend, "backend");

        if (IsPostgresRunning())
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

    // --- Postgres ---------------------------------------------------------

    private async Task EnsurePostgresInitializedAsync(CancellationToken ct)
    {
        if (File.Exists(Path.Combine(ServerPaths.PgDataDir, "PG_VERSION"))) return;

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

    private bool IsPostgresRunning()
    {
        try
        {
            using var client = new System.Net.Sockets.TcpClient();
            return client.ConnectAsync("127.0.0.1", ServerPaths.PostgresPort).Wait(500);
        }
        catch
        {
            return false;
        }
    }

    private async Task StartPostgresAsync(CancellationToken ct)
    {
        if (IsPostgresRunning()) return; // already running from a prior launch that wasn't cleanly stopped

        var logPath = Path.Combine(ServerPaths.ServerLogDir, "postgres.log");
        var opts = $"-p {ServerPaths.PostgresPort} -c listen_addresses=127.0.0.1";
        var exit = await RunToolAsync(
            Path.Combine(ServerPaths.PostgresBinDir, "pg_ctl.exe"),
            $"start -D \"{ServerPaths.PgDataDir}\" -l \"{logPath}\" -w -t 30 -o \"{opts}\"",
            ServerPaths.PostgresBinDir,
            env: null,
            "pg_ctl-start",
            ct);
        if (exit != 0)
        {
            throw new InvalidOperationException($"Postgres did not start — see {logPath}");
        }
    }

    private async Task EnsureDatabaseCreatedAsync(CancellationToken ct)
    {
        // Idempotent: createdb fails harmlessly if "orderrestro" already
        // exists (checked by exit code / stderr rather than treated as fatal).
        var (exitCode, stderr) = await RunToolCapturedAsync(
            Path.Combine(ServerPaths.PostgresBinDir, "createdb.exe"),
            "-U orderrestro -h 127.0.0.1 -p " + ServerPaths.PostgresPort + " orderrestro",
            ServerPaths.PostgresBinDir,
            env: null,
            "createdb",
            ct);
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
        var exit = await RunToolAsync(
            ServerPaths.NodeExePath,
            $"\"{prismaCli}\" migrate deploy",
            ServerPaths.BackendWorkingDir,
            env,
            "migrate",
            ct);
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
        var logWriter = new StreamWriter(File.Open(logPath, FileMode.Create, FileAccess.Write, FileShare.Read)) { AutoFlush = true };
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
    private static async Task<(int ExitCode, string Stderr)> RunToolCapturedAsync(
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
        return (proc.ExitCode, stderrTask.Result);
    }

    private static async Task<int> RunToolAsync(string exe, string args, string workingDir, Dictionary<string, string>? env, string logName, CancellationToken ct)
    {
        var (exitCode, _) = await RunToolCapturedAsync(exe, args, workingDir, env, logName, ct);
        return exitCode;
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

    public void Dispose()
    {
        StopProcess(ref _web, "web");
        StopProcess(ref _backend, "backend");
    }
}
