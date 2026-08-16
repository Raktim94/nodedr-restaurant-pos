namespace OrderRestro.Launcher;

internal static class Program
{
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

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
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
