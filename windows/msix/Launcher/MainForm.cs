using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace OrderRestro.Launcher;

internal sealed class MainForm : Form
{
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private readonly Label _errorLabel = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 11f),
        Visible = false,
    };
    private AppConfig _config;
    private ServerSupervisor? _supervisor;
    private TrayIcon? _tray;
    private bool _allowClose;

    public MainForm()
    {
        Text = "Nodedr OrderRestro";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1360, 860);
        MinimumSize = new Size(900, 600);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        _config = AppConfig.Load();

        BuildMenu();
        Controls.Add(_errorLabel);
        Controls.Add(_webView);

        Load += async (_, _) => await InitializeAsync();
        FormClosing += OnFormClosing;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            // Safety net for any exit path other than the tray's explicit
            // "Stop Server & Exit" (which already awaits a graceful
            // pg_ctl/backend/web shutdown before closing) — e.g. Windows
            // shutdown/logoff, Task Manager "End task". Not graceful, but
            // Postgres/Node both tolerate an unclean kill; better than
            // orphaning the child processes.
            _tray?.Dispose();
            _supervisor?.Dispose();
        }
        base.Dispose(disposing);
    }

    private void BuildMenu()
    {
        var menu = new MenuStrip();
        var fileMenu = new ToolStripMenuItem("File");

        // "Change server address…" only makes sense in thin-client mode —
        // an embedded-mode install always points at its own localhost
        // server, there's nothing to change.
        if (!_config.IsEmbedded)
        {
            var changeServer = new ToolStripMenuItem("Change server address…");
            changeServer.Click += async (_, _) => await ChangeServerAsync();
            fileMenu.DropDownItems.Add(changeServer);
            fileMenu.DropDownItems.Add(new ToolStripSeparator());
        }

        var exit = new ToolStripMenuItem("Exit");
        exit.Click += (_, _) => RequestRealExit();
        fileMenu.DropDownItems.Add(exit);

        var viewMenu = new ToolStripMenuItem("View");
        var reload = new ToolStripMenuItem("Reload") { ShortcutKeys = Keys.F5 };
        reload.Click += (_, _) => _webView.Reload();
        viewMenu.DropDownItems.Add(reload);

        menu.Items.Add(fileMenu);
        menu.Items.Add(viewMenu);
        MainMenuStrip = menu;
        Controls.Add(menu);
    }

    private async Task InitializeAsync()
    {
        if (string.IsNullOrWhiteSpace(_config.Mode))
        {
            using var choiceDialog = new FirstRunChoiceForm();
            var choiceResult = choiceDialog.ShowDialog(this);
            if (choiceResult != DialogResult.OK || choiceDialog.Result is null)
            {
                Close();
                return;
            }

            if (choiceDialog.Result == FirstRunChoice.Embedded)
            {
                _config.Mode = "embedded";
                _config.ServerUrl = $"http://localhost:{ServerPaths.WebPort}";
                _config.Save();
                // Menu was built before this choice existed — rebuild so
                // "Change server address…" is correctly hidden now.
                Controls.Remove(MainMenuStrip);
                BuildMenu();
            }
            else
            {
                await ChangeServerAsync(isFirstRun: true);
                if (_config.ServerUrl is null) return; // user cancelled — ChangeServerAsync already closed the form
                // Must be non-empty so this choice screen doesn't reappear
                // on every future launch (see the IsNullOrWhiteSpace(Mode)
                // check above) — "embedded" is the only value anything
                // else checks for, so any other non-empty string means
                // "thin client."
                _config.Mode = "remote";
                _config.Save();
            }
        }
        else if (!_config.IsEmbedded &&
                 (string.IsNullOrWhiteSpace(_config.ServerUrl) || !AppConfig.IsValidServerUrl(_config.ServerUrl, out _)))
        {
            await ChangeServerAsync(isFirstRun: true);
        }

        if (_config.IsEmbedded && !await StartEmbeddedServerAsync())
        {
            return; // fatal error already shown
        }

        Directory.CreateDirectory(AppConfig.WebView2UserDataFolder);
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(
                userDataFolder: AppConfig.WebView2UserDataFolder);
            await _webView.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            // Present on Windows 11 and most Windows 10 systems, but not
            // guaranteed — show an actionable message instead of an
            // unhandled crash (see Program.cs's last-resort handler for
            // anything this doesn't catch).
            ShowFatalError(
                "The Microsoft Edge WebView2 Runtime is required but isn't installed on this PC.\n\n" +
                "Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 (Evergreen " +
                "Bootstrapper), then reopen Nodedr OrderRestro.");
            return;
        }
        catch (Exception ex)
        {
            ShowFatalError($"Could not start the embedded browser component.\n\n{ex.Message}");
            return;
        }

        // Minimum-privilege WebView2 settings: no dev tools / no default
        // context menu with "Inspect" for end users, no crash-reporting
        // status page noise. Printing stays enabled — window.print() must
        // keep reaching the native OS print dialog (Windows Print
        // Spooler), which is the whole point of this client.
        var settings = _webView.CoreWebView2.Settings;
        settings.AreDevToolsEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = true;
        settings.IsSwipeNavigationEnabled = false;

        // Keep everything in one window instead of spawning stray popups —
        // this must still feel like a normal desktop app, not a browser.
        _webView.CoreWebView2.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            _webView.CoreWebView2.Navigate(args.Uri);
        };

        _webView.NavigationCompleted += (_, args) =>
        {
            if (!args.IsSuccess)
            {
                ShowConnectionError();
            }
            else
            {
                _errorLabel.Visible = false;
                _webView.Visible = true;
            }
        };

        Navigate();
    }

    private async Task<bool> StartEmbeddedServerAsync()
    {
        _supervisor = new ServerSupervisor();
        _supervisor.StatusChanged += status =>
        {
            // Control.BeginInvoke's parameter type is the abstract
            // System.Delegate, which a bare lambda/method group can't
            // implicitly convert to — every call here needs an explicit
            // concrete delegate cast (Action).
            if (InvokeRequired) { BeginInvoke((Action)(() => ShowStatus(status))); return; }
            ShowStatus(status);
        };
        _supervisor.Faulted += message =>
        {
            if (InvokeRequired) { BeginInvoke((Action)(() => _tray?.ShowBalloon("Nodedr OrderRestro", message))); return; }
            _tray?.ShowBalloon("Nodedr OrderRestro", message);
        };

        ShowStatus("Starting server…");
        try
        {
            // Generous first-run budget: EnsureRuntimeCopyAsync copies the
            // whole embedded-server payload (Postgres + Node + backend +
            // web, a few hundred MB) out of the read-only MSIX install
            // location on the very first launch only — every launch after
            // that skips it and starts in seconds.
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(8));
            await _supervisor.StartAsync(cts.Token);
        }
        catch (Exception ex)
        {
            ShowFatalError(
                $"Could not start the embedded server.\n\n{ex.Message}\n\n" +
                $"Logs: {ServerPaths.ServerLogDir}");
            return false;
        }

        // Icon is always set in the constructor (ExtractAssociatedIcon
        // falls back to SystemIcons.Application) — the compiler just can't
        // see that far, hence the null-forgiving operator.
        _tray = new TrayIcon(Icon!);
        _tray.OpenRequested += () =>
        {
            if (InvokeRequired) { BeginInvoke((Action)RestoreFromTray); return; }
            RestoreFromTray();
        };
        _tray.StopAndExitRequested += async () =>
        {
            if (InvokeRequired) { BeginInvoke((Action)(async () => await StopServerAndExitAsync())); return; }
            await StopServerAndExitAsync();
        };
        return true;
    }

    private void RestoreFromTray()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private async Task StopServerAndExitAsync()
    {
        ShowStatus("Stopping server…");
        if (_supervisor is not null) await _supervisor.StopAsync();
        RequestRealExit();
    }

    private void RequestRealExit()
    {
        _allowClose = true;
        Close();
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        // Only embedded-mode installs have anything to keep alive in the
        // background — a pure thin client closes normally, same as before
        // this feature existed.
        if (_config.IsEmbedded && !_allowClose && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            _tray?.ShowBalloon(
                "Nodedr OrderRestro",
                "Still running in the background so other devices stay connected. Use the tray icon to reopen or fully stop it.",
                ToolTipIcon.Info);
        }
    }

    private void Navigate()
    {
        if (_config.ServerUrl is null) return;
        _webView.CoreWebView2.Navigate(_config.ServerUrl);
    }

    private void ShowStatus(string message)
    {
        _webView.Visible = false;
        _errorLabel.Text = message;
        _errorLabel.Visible = true;
        _tray?.SetStatus(message);
    }

    private void ShowConnectionError()
    {
        _webView.Visible = false;
        _errorLabel.Text =
            $"Could not reach {_config.ServerUrl}.\n\n" +
            "Check that the OrderRestro server is running and this device is on\n" +
            "the same network, then choose File → Reload, or File → Change server address…";
        _errorLabel.Visible = true;
    }

    private void ShowFatalError(string message)
    {
        _webView.Visible = false;
        _errorLabel.Text = message;
        _errorLabel.Visible = true;
    }

    private async Task ChangeServerAsync(bool isFirstRun = false)
    {
        using var dialog = new ServerSettingsForm(_config.ServerUrl);
        var result = dialog.ShowDialog(this);
        if (result != DialogResult.OK || dialog.Result is null)
        {
            if (isFirstRun) Close();
            return;
        }
        _config.ServerUrl = dialog.Result;
        _config.Save();
        if (_webView.CoreWebView2 is not null) Navigate();
        await Task.CompletedTask;
    }
}
