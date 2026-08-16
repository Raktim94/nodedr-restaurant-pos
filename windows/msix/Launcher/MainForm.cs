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

    public MainForm()
    {
        Text = "Nodedr OrderRestro";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1360, 860);
        MinimumSize = new Size(900, 600);

        _config = AppConfig.Load();

        BuildMenu();
        Controls.Add(_errorLabel);
        Controls.Add(_webView);

        Load += async (_, _) => await InitializeAsync();
    }

    private void BuildMenu()
    {
        var menu = new MenuStrip();
        var fileMenu = new ToolStripMenuItem("File");
        var changeServer = new ToolStripMenuItem("Change server address…");
        changeServer.Click += async (_, _) => await ChangeServerAsync();
        var exit = new ToolStripMenuItem("Exit");
        exit.Click += (_, _) => Close();
        fileMenu.DropDownItems.Add(changeServer);
        fileMenu.DropDownItems.Add(new ToolStripSeparator());
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
        if (string.IsNullOrWhiteSpace(_config.ServerUrl) ||
            !AppConfig.IsValidServerUrl(_config.ServerUrl, out _))
        {
            await ChangeServerAsync(isFirstRun: true);
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

    private void Navigate()
    {
        if (_config.ServerUrl is null) return;
        _webView.CoreWebView2.Navigate(_config.ServerUrl);
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
