namespace OrderRestro.Launcher;

internal enum FirstRunChoice
{
    Embedded,
    RemoteClient,
}

/// <summary>
/// The first screen a fresh install shows: run OrderRestro on this computer,
/// or connect to a server that already runs somewhere else. A brand header,
/// two clearly different choices (the local one is the recommended path for a
/// first-time owner) and a short "what happens next" strip so nobody is
/// surprised by the few minutes the first start takes. Choosing never touches
/// existing data: it only records which mode to open next time (change it
/// later from the app menu). Fully keyboard-operable: Tab between the two
/// buttons, Enter picks the focused one, Esc closes the app.
/// </summary>
internal sealed class FirstRunChoiceForm : Form
{
    private static readonly Color Brand = Color.FromArgb(0x9f, 0x12, 0x39);
    private static readonly Color BrandDark = Color.FromArgb(0x7a, 0x0d, 0x2c);
    private static readonly Color Ink = Color.FromArgb(0x1c, 0x19, 0x17);
    private static readonly Color Muted = Color.FromArgb(0x57, 0x53, 0x4e);
    private static readonly Color Line = Color.FromArgb(0xe7, 0xe2, 0xdd);

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
        ClientSize = new Size(680, 640);
        KeyPreview = true;
        KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Escape) { DialogResult = DialogResult.Cancel; Close(); }
        };

        // ---- Header band ---------------------------------------------------
        var header = new Panel { Location = new Point(0, 0), Size = new Size(680, 128), BackColor = Brand };
        var logo = new PictureBox
        {
            Location = new Point(32, 28),
            Size = new Size(72, 72),
            SizeMode = PictureBoxSizeMode.Zoom,
            BackColor = Color.Transparent,
            AccessibleName = "OrderRestro logo",
        };
        try
        {
            using var ico = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (ico is not null) logo.Image = new Icon(ico, 64, 64).ToBitmap();
        }
        catch { /* the logo is decoration: never block the first run on it */ }
        var title = new Label
        {
            Text = "Welcome to OrderRestro",
            Font = new Font("Segoe UI Semibold", 22f, FontStyle.Bold),
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            AutoSize = false,
            Location = new Point(120, 26),
            Size = new Size(528, 46),
        };
        var sub = new Label
        {
            Text = "Billing, tables, kitchen and stock for your restaurant. Let's get you started.",
            ForeColor = Color.FromArgb(0xfd, 0xe4, 0xea),
            BackColor = Color.Transparent,
            AutoSize = false,
            Location = new Point(122, 74),
            Size = new Size(528, 40),
        };
        header.Controls.Add(logo);
        header.Controls.Add(title);
        header.Controls.Add(sub);

        var ask = new Label
        {
            Text = "How would you like to use OrderRestro on this computer?",
            Font = new Font("Segoe UI Semibold", 12f, FontStyle.Bold),
            ForeColor = Ink,
            AutoSize = false,
            Location = new Point(32, 148),
            Size = new Size(616, 28),
        };

        // ---- Two choices ---------------------------------------------------
        var localCard = Card(
            top: 188,
            height: 200,
            glyph: "", // Segoe MDL2: Devices / PC
            heading: "Start on this computer",
            badge: "Recommended for new restaurants",
            body: "Run your whole restaurant from this computer. Your data stays here and billing keeps working without internet.",
            note: "No server and no technical setup.",
            button: "Start on this computer",
            primary: true,
            choice: FirstRunChoice.Embedded);

        var serverCard = Card(
            top: 400,
            height: 178,
            glyph: "", // Segoe MDL2: Cloud
            heading: "Connect to my existing server",
            badge: null,
            body: "Already running OrderRestro on another computer or in the cloud? Connect this app to your existing restaurant.",
            note: "You will need your server's address (for example orders.myrestaurant.com).",
            button: "Connect to server",
            primary: false,
            choice: FirstRunChoice.RemoteClient);

        // ---- What happens next ---------------------------------------------
        var next = new Label
        {
            Text = "What happens next: the first start prepares the database (about 2 to 5 minutes, only once). " +
                   "Then you create the owner account and add your menu. You can change this choice later from the File menu.",
            ForeColor = Muted,
            Font = new Font("Segoe UI", 9f),
            AutoSize = false,
            Location = new Point(32, 590),
            Size = new Size(616, 40),
        };

        Controls.Add(header);
        Controls.Add(ask);
        Controls.Add(localCard);
        Controls.Add(serverCard);
        Controls.Add(next);
        AcceptButton = localCard.Controls.OfType<Button>().First();
        ActiveControl = AcceptButton as Control;
    }

    private Panel Card(int top, int height, string glyph, string heading, string? badge, string body, string note,
                       string button, bool primary, FirstRunChoice choice)
    {
        var rest = primary ? Color.FromArgb(0xfd, 0xf2, 0xf4) : Color.FromArgb(0xfa, 0xf7, 0xf5);
        var hover = primary ? Color.FromArgb(0xfb, 0xe4, 0xe9) : Color.FromArgb(0xf3, 0xee, 0xea);
        var card = new Panel
        {
            Location = new Point(32, top),
            Size = new Size(616, height),
            BackColor = rest,
        };
        // Accent strip on the left edge: the recommended card gets the brand colour.
        var strip = new Panel
        {
            Location = new Point(0, 0),
            Size = new Size(5, height),
            BackColor = primary ? Brand : Line,
        };
        var icon = new Label
        {
            Text = glyph,
            Font = new Font("Segoe MDL2 Assets", 20f),
            ForeColor = primary ? Brand : Muted,
            BackColor = Color.Transparent,
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleCenter,
            Location = new Point(20, 16),
            Size = new Size(44, 44),
            AccessibleRole = AccessibleRole.None,
        };
        var h = new Label
        {
            Text = heading,
            Font = new Font("Segoe UI Semibold", 13f, FontStyle.Bold),
            ForeColor = Ink,
            BackColor = Color.Transparent,
            AutoSize = false,
            Location = new Point(76, 14),
            Size = new Size(520, 28),
        };
        var textTop = 44;
        if (badge is not null)
        {
            var bd = new Label
            {
                Text = badge,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                ForeColor = Brand,
                BackColor = Color.Transparent,
                AutoSize = false,
                Location = new Point(76, 42),
                Size = new Size(520, 20),
            };
            card.Controls.Add(bd);
            textTop = 64;
        }
        var b = new Label
        {
            Text = body,
            ForeColor = Ink,
            BackColor = Color.Transparent,
            AutoSize = false,
            Location = new Point(76, textTop),
            Size = new Size(520, 44),
        };
        var n = new Label
        {
            Text = note,
            ForeColor = Muted,
            Font = new Font("Segoe UI", 9f),
            BackColor = Color.Transparent,
            AutoSize = false,
            Location = new Point(76, textTop + 46),
            Size = new Size(520, 22),
        };
        var btn = new Button
        {
            Text = button,
            Location = new Point(20, height - 62),
            Size = new Size(576, 46),
            Font = new Font("Segoe UI Semibold", 11f, FontStyle.Bold),
            FlatStyle = FlatStyle.Flat,
            TabStop = true,
            UseVisualStyleBackColor = false,
            BackColor = primary ? Brand : Color.White,
            ForeColor = primary ? Color.White : Ink,
            Cursor = Cursors.Hand,
            AccessibleName = heading,
            AccessibleDescription = body,
        };
        btn.FlatAppearance.BorderColor = primary ? Brand : Color.FromArgb(0xa8, 0xa2, 0x9e);
        btn.FlatAppearance.MouseOverBackColor = primary ? BrandDark : Color.FromArgb(0xf5, 0xf0, 0xec);
        btn.FlatAppearance.MouseDownBackColor = primary ? BrandDark : Color.FromArgb(0xea, 0xe4, 0xde);
        btn.Click += (_, _) => Accept(choice);
        // Visible keyboard focus: a thick brand-coloured outline, not just the default dotted line.
        btn.Enter += (_, _) => btn.FlatAppearance.BorderSize = 3;
        btn.Leave += (_, _) => btn.FlatAppearance.BorderSize = 1;
        // The whole card reacts on hover and clicking the text acts like the button.
        void Over(object? s, EventArgs e) => card.BackColor = hover;
        void Out(object? s, EventArgs e)
        {
            if (!card.ClientRectangle.Contains(card.PointToClient(Cursor.Position))) card.BackColor = rest;
        }
        foreach (Control c in new Control[] { card, icon, h, b, n, btn })
        {
            c.MouseEnter += Over;
            c.MouseLeave += Out;
        }
        foreach (Control c in new Control[] { icon, h, b, n })
        {
            c.Cursor = Cursors.Hand;
            c.Click += (_, _) => Accept(choice);
        }
        card.Controls.Add(strip);
        card.Controls.Add(icon);
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
