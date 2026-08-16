namespace OrderRestro.Launcher;

internal enum FirstRunChoice
{
    Embedded,
    RemoteClient,
}

/// <summary>
/// The very first screen a fresh install shows: is this PC the one running
/// the restaurant's server, or is it a till/tablet connecting to a server
/// that's already running somewhere else? Replaces unconditionally
/// prompting for a server address — most restaurants only have ONE machine
/// that needs to answer "yes" to the first option; every other device
/// picks the second and gets the existing ServerSettingsForm flow.
/// </summary>
internal sealed class FirstRunChoiceForm : Form
{
    public FirstRunChoice? Result { get; private set; }

    public FirstRunChoiceForm()
    {
        Text = "Welcome to Nodedr OrderRestro";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(480, 260);

        var title = new Label
        {
            Text = "How is this computer being used?",
            Font = new Font("Segoe UI", 12f, FontStyle.Bold),
            AutoSize = false,
            Location = new Point(20, 16),
            Size = new Size(440, 28),
        };

        var embeddedButton = new Button
        {
            Text = "This is the main computer\n(runs the restaurant's server)",
            Location = new Point(20, 64),
            Size = new Size(440, 60),
            TextAlign = ContentAlignment.MiddleCenter,
        };
        var embeddedHelp = new Label
        {
            Text = "Sets everything up here — other tills and tablets will connect to this PC.",
            ForeColor = SystemColors.GrayText,
            AutoSize = false,
            Location = new Point(20, 126),
            Size = new Size(440, 20),
        };
        embeddedButton.Click += (_, _) => Accept(FirstRunChoice.Embedded);

        var remoteButton = new Button
        {
            Text = "Connect to an existing OrderRestro server",
            Location = new Point(20, 160),
            Size = new Size(440, 40),
            TextAlign = ContentAlignment.MiddleCenter,
        };
        var remoteHelp = new Label
        {
            Text = "Pick this for any additional till or tablet — you'll enter the main computer's address next.",
            ForeColor = SystemColors.GrayText,
            AutoSize = false,
            Location = new Point(20, 202),
            Size = new Size(440, 32),
        };
        remoteButton.Click += (_, _) => Accept(FirstRunChoice.RemoteClient);

        Controls.Add(title);
        Controls.Add(embeddedButton);
        Controls.Add(embeddedHelp);
        Controls.Add(remoteButton);
        Controls.Add(remoteHelp);
    }

    private void Accept(FirstRunChoice choice)
    {
        Result = choice;
        DialogResult = DialogResult.OK;
        Close();
    }
}
