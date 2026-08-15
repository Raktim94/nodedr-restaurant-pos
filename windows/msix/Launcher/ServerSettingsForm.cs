namespace OrderRestro.Launcher;

/// <summary>
/// First-run (and "change server") dialog: the restaurant's own OrderRestro
/// server address on the LAN, e.g. http://192.168.1.50:1995. No cloud
/// account, no bundled server — this app is a pure client, per the
/// hardening brief's offline-first / LAN-server requirement.
/// </summary>
internal sealed class ServerSettingsForm : Form
{
    private readonly TextBox _urlBox;
    public string? Result { get; private set; }

    public ServerSettingsForm(string? currentUrl)
    {
        Text = "Connect to OrderRestro server";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(440, 150);

        var label = new Label
        {
            Text = "Enter your restaurant's OrderRestro server address\n(ask your admin, e.g. http://192.168.1.50:1995):",
            AutoSize = false,
            Location = new Point(16, 16),
            Size = new Size(408, 40),
        };

        _urlBox = new TextBox
        {
            Location = new Point(16, 60),
            Size = new Size(408, 24),
            Text = currentUrl ?? "http://",
        };

        var connectButton = new Button
        {
            Text = "Connect",
            Location = new Point(268, 96),
            Size = new Size(80, 28),
            DialogResult = DialogResult.OK,
        };
        connectButton.Click += (_, _) => OnConnect();

        var cancelButton = new Button
        {
            Text = "Cancel",
            Location = new Point(352, 96),
            Size = new Size(72, 28),
            DialogResult = DialogResult.Cancel,
        };

        AcceptButton = connectButton;
        CancelButton = cancelButton;

        Controls.Add(label);
        Controls.Add(_urlBox);
        Controls.Add(connectButton);
        Controls.Add(cancelButton);
    }

    private void OnConnect()
    {
        if (!AppConfig.IsValidServerUrl(_urlBox.Text, out _))
        {
            MessageBox.Show(
                this,
                "Enter a valid server address starting with http:// or https://",
                "Invalid address",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            DialogResult = DialogResult.None;
            return;
        }
        Result = _urlBox.Text.Trim();
    }
}
