namespace OrderRestro.Launcher;

internal enum FirstRunChoice
{
    Embedded,
    RemoteClient,
}

/// <summary>
/// The first screen a fresh install shows: run OrderRestro on this computer,
/// or connect to a server that already runs somewhere else. Two cards; the
/// local option is the prominent one for a first-time owner. Choosing never
/// touches existing data: it only records which mode to open next time
/// (change it later from the app menu).
/// </summary>
internal sealed class FirstRunChoiceForm : Form
{
    private static readonly Color Brand = Color.FromArgb(0x9f, 0x12, 0x39);

    public FirstRunChoice? Result { get; private set; }

    public FirstRunChoiceForm()
    {
        Text = "OrderRestro";
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96f, 96f);
        Font = new Font("Segoe UI", 10f);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        BackColor = Color.White;
        ClientSize = new Size(620, 500);

        var title = new Label
        {
            Text = "Welcome to OrderRestro",
            Font = new Font("Segoe UI", 20f, FontStyle.Bold),
            AutoSize = false,
            Location = new Point(28, 20),
            Size = new Size(564, 40),
        };
        var sub = new Label
        {
            Text = "Choose how you want to use OrderRestro on this computer.",
            ForeColor = Color.FromArgb(0x57, 0x53, 0x4e),
            AutoSize = false,
            Location = new Point(28, 62),
            Size = new Size(564, 26),
        };

        // Card 1: the prominent, first-time choice.
        var localCard = Card(
            top: 104,
            height: 190,
            heading: "Start on this computer",
            body: "New to OrderRestro? Run your restaurant from this computer. Your data is stored here, and you can continue working without internet.",
            note: "No server or technical setup required.",
            button: "Start on this computer",
            primary: true,
            choice: FirstRunChoice.Embedded);

        // Card 2: an existing server.
        var serverCard = Card(
            top: 308,
            height: 170,
            heading: "Connect to my existing server",
            body: "Already running OrderRestro on a cloud server or another computer? Connect this app to your existing restaurant.",
            note: "You will need the address of your existing OrderRestro server.",
            button: "Connect to server",
            primary: false,
            choice: FirstRunChoice.RemoteClient);

        Controls.Add(title);
        Controls.Add(sub);
        Controls.Add(localCard);
        Controls.Add(serverCard);
        AcceptButton = localCard.Controls.OfType<Button>().First();
    }

    private Panel Card(int top, int height, string heading, string body, string note, string button, bool primary, FirstRunChoice choice)
    {
        var card = new Panel
        {
            Location = new Point(28, top),
            Size = new Size(564, height),
            BackColor = primary ? Color.FromArgb(0xfd, 0xf2, 0xf4) : Color.FromArgb(0xfa, 0xf7, 0xf5),
            Padding = new Padding(16),
        };
        var h = new Label
        {
            Text = heading,
            Font = new Font("Segoe UI", 13f, FontStyle.Bold),
            AutoSize = false,
            Location = new Point(16, 12),
            Size = new Size(530, 28),
        };
        var b = new Label
        {
            Text = body,
            AutoSize = false,
            Location = new Point(16, 42),
            Size = new Size(530, 48),
        };
        var n = new Label
        {
            Text = note,
            ForeColor = Color.FromArgb(0x57, 0x53, 0x4e),
            AutoSize = false,
            Location = new Point(16, 92),
            Size = new Size(530, 24),
        };
        var btn = new Button
        {
            Text = button,
            Location = new Point(16, height - 56),
            Size = new Size(530, 44),
            Font = new Font("Segoe UI", 11f, FontStyle.Bold),
            FlatStyle = FlatStyle.Flat,
            TabStop = true,
            UseVisualStyleBackColor = false,
            BackColor = primary ? Brand : Color.White,
            ForeColor = primary ? Color.White : Color.Black,
            AccessibleName = heading,
            AccessibleDescription = body,
        };
        btn.FlatAppearance.BorderColor = primary ? Brand : Color.FromArgb(0xa8, 0xa2, 0x9e);
        btn.Click += (_, _) => Accept(choice);
        card.Controls.Add(h);
        card.Controls.Add(b);
        card.Controls.Add(n);
        card.Controls.Add(btn);
        return card;
    }

    private void Accept(FirstRunChoice choice)
    {
        Result = choice;
        DialogResult = DialogResult.OK;
        Close();
    }
}
