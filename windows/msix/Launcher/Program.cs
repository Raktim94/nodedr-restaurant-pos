namespace OrderRestro.Launcher;

internal static class Program
{
    // Embedded-mode installs minimize to the tray instead of exiting on
    // window close (see MainForm.OnFormClosing/TrayIcon) so other LAN
    // devices keep working — which means a user who thinks they "closed"
    // the app and reopens it (Start Menu, desktop shortcut) is actually
    // launching a SECOND process against an already-running first one.
    // Without a guard, that second process runs ServerSupervisor.StartAsync
    // again and collides with the first instance's still-open, exclusively-
    // held backend.log/web.log file handles (see ServerSupervisor.
    // StartLongRunning's FileShare.Read-only open) — exactly the "process
    // cannot access the file ... because it is being used by another
    // process" crash this guard exists to prevent. "Local\" (not "Global\")
    // is correct here: this is a per-user desktop app, not a service shared
    // across sessions, and Local\ needs no extra permissions.
    private const string SingleInstanceMutexName = "Local\\NodedrOrderRestro_SingleInstance_9F3D2E7A";
    private const string ActivateEventName = "Local\\NodedrOrderRestro_Activate_9F3D2E7A";

    [STAThread]
    private static void Main()
    {
        // WACK and Store cert both check that a packaged app never dies
        // with a raw unhandled-exception dialog / silent crash — surface a
        // plain-language message and keep the process alive/exit cleanly
        // instead. This is a last-resort net; specific failure paths (e.g.
        // WebView2 Runtime missing) are still handled locally in MainForm
        // with a friendlier, actionable message first.
        Application.ThreadException += (_, args) => ReportFatal(args.Exception);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            ReportFatal(args.ExceptionObject as Exception ?? new Exception(args.ExceptionObject?.ToString()));

        using var singleInstanceMutex = new Mutex(initiallyOwned: true, SingleInstanceMutexName, out var createdNew);
        if (!createdNew)
        {
            // A real instance already owns the app (visible or minimized to
            // tray) — signal it to come to the foreground and exit
            // immediately, before touching ServerSupervisor/ports/log files
            // at all.
            try
            {
                using var existingActivateEvent = EventWaitHandle.OpenExisting(ActivateEventName);
                existingActivateEvent.Set();
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                // Narrow startup race: the first instance owns the mutex
                // but hasn't created its activate event yet. Nothing to
                // signal, but exiting is still correct — a real instance
                // already owns the app and will finish starting on its own.
            }
            return;
        }

        using var activateEvent = new EventWaitHandle(initialState: false, EventResetMode.AutoReset, ActivateEventName);

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(activateEvent));
    }

    private static void ReportFatal(Exception ex)
    {
        try
        {
            Directory.CreateDirectory(AppConfig.LogDir);
            var logPath = Path.Combine(AppConfig.LogDir, $"crash-{DateTime.UtcNow:yyyyMMdd-HHmmss}.log");
            File.WriteAllText(logPath, ex.ToString());
        }
        catch
        {
            // Logging is best-effort — never let a failure to write the
            // crash log itself take down the crash handler.
        }

        MessageBox.Show(
            $"Nodedr OrderRestro hit an unexpected error and needs to close.\n\n{ex.Message}\n\n" +
            $"Details were saved to:\n{AppConfig.LogDir}",
            "Nodedr OrderRestro",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }
}
