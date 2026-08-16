namespace OrderRestro.Launcher;

/// <summary>
/// System tray presence for embedded-server mode: lets the till window be
/// closed (minimized, not exited — see MainForm's Closing handler) without
/// taking down the server every other LAN device depends on. Only
/// instantiated when running in embedded mode; a pure thin-client install
/// has no tray icon and closing its window exits normally, same as before
/// this feature.
/// </summary>
internal sealed class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;

    public event Action? OpenRequested;
    public event Action? StopAndExitRequested;

    public TrayIcon(Icon appIcon)
    {
        var menu = new ContextMenuStrip();
        var open = new ToolStripMenuItem("Open Nodedr OrderRestro");
        open.Click += (_, _) => OpenRequested?.Invoke();
        var viewLogs = new ToolStripMenuItem("View server logs");
        viewLogs.Click += (_, _) =>
        {
            Directory.CreateDirectory(ServerPaths.ServerLogDir);
            System.Diagnostics.Process.Start("explorer.exe", ServerPaths.ServerLogDir);
        };
        var stopAndExit = new ToolStripMenuItem("Stop Server && Exit");
        stopAndExit.Click += (_, _) => StopAndExitRequested?.Invoke();

        menu.Items.Add(open);
        menu.Items.Add(viewLogs);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(stopAndExit);

        _icon = new NotifyIcon
        {
            Icon = appIcon,
            Text = "Nodedr OrderRestro — server running",
            Visible = true,
            ContextMenuStrip = menu,
        };
        _icon.DoubleClick += (_, _) => OpenRequested?.Invoke();
    }

    public void ShowBalloon(string title, string message, ToolTipIcon icon = ToolTipIcon.Warning)
    {
        _icon.BalloonTipTitle = title;
        _icon.BalloonTipText = message;
        _icon.BalloonTipIcon = icon;
        _icon.ShowBalloonTip(10000);
    }

    public void SetStatus(string text) => _icon.Text = $"Nodedr OrderRestro — {text}".Length > 63
        ? $"Nodedr OrderRestro — {text}"[..63]
        : $"Nodedr OrderRestro — {text}"; // NotifyIcon.Text has a 63-char OS limit

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
    }
}
