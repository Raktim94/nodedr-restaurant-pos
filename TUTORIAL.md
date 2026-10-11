# OrderRestro Tutorial

> 💡 **Note:** The interface is responsive. It works on a counter PC, a tablet at the till, a phone, and on a second monitor facing the customer.

A walkthrough from a fresh install to your first UPI sale, then payroll, accounting and reports. Each section stands alone, so jump to what you need.

- [1. Install](#1-install)
- [2. First-time setup](#2-first-time-setup)
- [3. Build your menu and floor](#3-build-your-menu-and-floor)
- [4. Take an order](#4-take-an-order)
- [UPI QR payments and the customer display](#upi-qr-payments-and-the-customer-display)
- [5. Kitchen display](#5-kitchen-display)
- [6. Staff: attendance, shifts, leave and payroll](#6-staff-attendance-shifts-leave-and-payroll)
- [7. Inventory and branch stock transfers](#7-inventory-and-branch-stock-transfers)
- [8. Accounting](#8-accounting)
- [9. Reports, exports and scheduled emails](#9-reports-exports-and-scheduled-emails)
- [10. Documents and attachments](#10-documents-and-attachments)
- [11. Security, backup and updates](#11-security-backup-and-updates)
- [Troubleshooting](#troubleshooting)

## 1. Install

You need a machine that stays on in the restaurant (a mini PC, an old laptop, a NAS, or a VPS) with Docker.

```bash
git clone https://github.com/Raktim94/nodedr-restaurant-pos.git
cd nodedr-restaurant-pos
./install.sh
```

Then open `http://<that machine's IP>:1995` from any till or tablet on the same network.

On **CasaOS / ZimaOS**, install the app from the compose manifest in [`casaos/`](./casaos/README.md). No build step is needed, because pre-built amd64 and arm64 images are published.

> Using it over HTTPS (a tunnel or reverse proxy)? Set `COOKIE_SECURE=true` in `.env`, or login will appear to succeed and then fail with "Unauthorized".

![Login](docs/screenshots/login.png)

## 2. First-time setup

1. Sign in as the owner account the installer created.
2. Open **Settings → Restaurant** and set your name, currency (`INR`) and timezone.
3. Open **Settings → This branch** and set the address, phone, GSTIN and the **tax regime** (India GST, US Sales Tax, EU VAT or Spain IVA) and whether menu prices include tax.
4. Open **Settings → Staff** and **Roles**. Create an account per person and give each role only the permissions it needs.

![Settings](docs/screenshots/or-settings-general.png)

## 3. Build your menu and floor

- **Menu**: add categories and items, attach modifier groups (size, spice level, add-ons) and build combos.
- **Tables**: draw floors, add tables, print each table's **QR code** so guests can order from their phone.

![Menu management](docs/screenshots/or-menu-management.png)
![Floor view](docs/screenshots/or-tables-floor.png)

## 4. Take an order

1. Open **POS**, pick a table or choose takeaway.
2. Tap items, choose modifiers, add notes.
3. Send to kitchen. A ticket (KOT) goes to the right station.
4. When the guest is ready, open the bill and choose **Complete payment**.

Discounts, coupons, loyalty points, gift cards and tips are all applied on the checkout panel. The server recalculates every amount, so the figure on the receipt is the figure that was charged.

![POS order](docs/screenshots/or-pos-order.png)
![Checkout](docs/screenshots/or-checkout-billing.png)

## UPI QR payments and the customer display

OrderRestro builds a standard UPI payment link for the **exact amount due**, so there is nothing to type in the customer's app and no payment-gateway fees.

### Set up

1. Go to **Settings → Restaurant**.
2. Enter your **UPI id** (for example `yourshop@okbank`) and the **payee name** customers should see.
3. Save.

### Take a UPI payment

1. At checkout choose **UPI** as the payment method.
2. A QR for the bill amount appears on the checkout panel.
3. The same QR appears full-screen on the **customer display**.
4. The guest scans it with GPay, PhonePe, Paytm or any UPI app and pays.
5. Check your UPI app or soundbox for the credit, then press **Complete payment**.

When the payment is recorded, the till plays a **payment-received chime** and the customer display shows **Thank you** and plays the same chime.

> The app does not read your bank's confirmation. Pressing **Complete payment** is how a cashier confirms that the money arrived, so always check your UPI app or soundbox first. Automatic confirmation needs a payment gateway, which is on the [roadmap](./ROADMAP.md).

### Customer-facing screen

1. On a second monitor or tablet, open `http://<server>:1995/customer-display`.
2. **Click or tap once anywhere** on that page. Browsers block sound until the page is touched. After that, payment sounds work.
3. Keep it in the **same browser** as the POS, in another window. The display follows the till live, with no server round trip.

It shows a welcome screen when idle, the running order and total while you ring up, the UPI QR at payment, and a thank-you once paid.

## 5. Kitchen display

Open `/kds` on a screen in the kitchen. Tickets appear in real time, with a timer that warns after 15 minutes. Bump a ticket when it is ready. Use priority and reprint for rush orders and lost tickets.

![Kitchen display](docs/screenshots/or-kot-kds.png)

## 6. Staff: attendance, shifts, leave and payroll

All of this is under **Attendance** and **Team** in the sidebar.

### Attendance

Staff **clock in and out** from the Attendance page (a PIN quick-switch is available at a shared till). Managers see everyone's hours and can correct a missed punch.

### Shifts

Schedule shifts per person per day. The scheduler **warns about clashes** (overlapping shifts for one person).

### Leave

Staff request leave; managers approve or reject. Approved **unpaid** leave is deducted from payroll automatically.

### Payroll

1. Set each person's pay rate under **Team**.
2. Create a payroll run for a period. The draft is calculated from **clocked hours**.
3. Review lines, then **finalize**. Finalized runs feed the profit & loss report.

### Tip pool

Tips collected in the period are **split by hours worked**, so a full shift earns a bigger share than a short one.

## 7. Inventory and branch stock transfers

- **Ingredients**: stock, reorder level and weighted-average cost, recomputed on each goods receipt.
- **Recipes**: link menu items to ingredients. Stock deducts on checkout, and a shortfall never blocks a sale.
- **Purchase orders → goods receipts**: receive stock with batch and expiry.
- **Waste**: logged FIFO at the real batch cost.

### Move stock between branches

1. Open **Inventory → Transfers** (you need at least two branches).
2. Choose the ingredient, quantity and destination branch, then **Transfer**.
3. The source branch is reduced first-in-first-out. The destination gets a new batch at the same cost, and its average cost updates. The ingredient is created at the destination on the first transfer.

![Inventory](docs/screenshots/or-inventory-ingredients-list.png)

## 8. Accounting

Open **Accounting**. Tabs:

| Tab | What it does |
| --- | --- |
| Expenses | Record spending; mark "paid from till" to count it in cash close. |
| Cash close | Count the drawer at night; shows expected cash and the variance. |
| Profit & loss | Net sales − expenses − payroll, for any range. |
| Balance sheet | A snapshot of cash, inventory, unpaid supplier invoices and gift-card balances. A management view from your POS records, **not** a statutory filing. |
| Budgets | Set a monthly budget per expense category and watch spending against it. |
| Bank | Import a bank statement CSV and match it to expenses. |
| GST | Tax summary by rate. |
| Branches | Sales, open orders, low stock and inventory value across locations. |

### Bank reconciliation

1. Download your bank statement as **CSV**. It needs a date, a description and either one `amount` column (negative for money out) or `debit` and `credit` columns.
2. In **Accounting → Bank**, choose **Import bank statement**.
3. Money-out lines are **auto-matched** to expenses with the same amount within 5 days.
4. For anything left over, press **Match** to pick the expense yourself, or **Ignore** for lines you do not track.

Importing the same file twice is safe: duplicates are skipped.

## 9. Reports, exports and scheduled emails

**Reports** has 18 reports (daily sales, sales by item, peak hours, food cost and margins, retention, tax, waste, and more).

- **Print** with the button, or export as **Excel**, **PDF** or **CSV**.
- Exporting needs the `data.export` permission.

### Email a report on a schedule

1. Set `SMTP_URL` and `SMTP_FROM` on the server (any SMTP provider works).
2. Open a report, scroll to **Email this report on a schedule**.
3. Choose daily, weekly or monthly, a format, and the recipients.

Reports are sent at 06:00 branch time: daily covers yesterday, weekly goes out on Monday for the previous 7 days, and monthly goes out on the 1st for the previous month. **Send now** tests a schedule immediately.

## 10. Documents and attachments

**Operations → Documents** holds SOPs, contracts, recipes and purchase paperwork. Open a document and use **Attach file** to add PDFs, images, text, Word or Excel files (5 MB each, up to 10 per document). Attachments are stored in the database, so backups carry them.

## 11. Security, backup and updates

- **Settings → Security**: turn on two-factor sign-in and save your recovery codes.
- **Settings → Audit log**: who did what, and when.
- **Settings → Backup**: schedule and restore backups. Test a restore before you need one.
- **Settings → Updates**: check for a new version.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Login works, then "Unauthorized" | Using HTTPS? Set `COOKIE_SECURE=true`. Plain HTTP? Keep it `false`. |
| No UPI QR at checkout | Add a UPI id in **Settings → Restaurant** and save. |
| Customer display is silent | Tap the display page once, so the browser allows sound. |
| Customer display does not follow the till | Open it in the **same browser profile** as the POS. |
| "Email is not set up" | Set `SMTP_URL` and `SMTP_FROM`, then restart the backend. |
| Transfer says unit mismatch | The destination stocks that ingredient in a different unit. Align the unit first. |

Still stuck? [Open an issue](https://github.com/Raktim94/nodedr-restaurant-pos/issues).
