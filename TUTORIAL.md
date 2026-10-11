# OrderRestro tutorial

Get from zero to your first UPI-paid order in about ten minutes, then set up staff, stock and accounts. Screenshots use fictional demo data.

**Contents:** [1. Start](#1-start-the-app) · [2. Sign in & set up](#2-sign-in-and-set-up) · [3. Menu, tables & customers](#3-build-your-menu-tables-and-customers) · [4. Take an order](#4-take-an-order) · [5. Get paid with UPI](#5-get-paid-with-upi) · [6. Kitchen](#6-kitchen-display) · [7. Staff & payroll](#7-staff-attendance-and-payroll) · [8. Inventory](#8-inventory) · [9. Accounting](#9-accounting) · [10. Reports](#10-reports-exports-and-scheduled-emails) · [11. The other screens](#11-the-other-screens) · [12. Connect other systems](#12-connect-other-systems)

---

## 1. Start the app

You need a machine that stays on in the restaurant (a mini PC, an old laptop, a NAS or a VPS) with Docker. The database is created for you on first start.

```bash
curl -fsSL https://raw.githubusercontent.com/Raktim94/nodedr-restaurant-pos/master/scripts/quickstart.sh | bash
```

Or from a clone:

```bash
git clone https://github.com/Raktim94/nodedr-restaurant-pos.git
cd nodedr-restaurant-pos
./install.sh
```

Open `http://<that machine's IP>:1995` from any till or tablet on the same network. On Windows use `quickstart.ps1`. On **CasaOS / ZimaOS**, install from the compose manifest in [`casaos/`](./casaos/README.md); pre-built amd64 and arm64 images are published, so nothing is compiled.

> Using it over HTTPS (a tunnel or reverse proxy)? Set `COOKIE_SECURE=true` in `.env`, or login will appear to succeed and then fail with "Unauthorized".

## 2. Sign in and set up

The first time you open the app, **Sign up** creates your restaurant and the owner account. After that, **Sign in** with the same email.

<table>
<tr>
<td><img src="docs/screenshots/tutorial/signup.png" alt="Create your restaurant"></td>
<td><img src="docs/screenshots/tutorial/login.png" alt="Sign in"></td>
</tr>
</table>

You land on the **Dashboard**: today's revenue, orders, occupied tables, kitchen queue, a 14-day revenue chart and food-waste cost. Light and dark mode are both supported, and it works on a phone.

![Dashboard](docs/screenshots/tutorial/dashboard.png)

<table>
<tr>
<td><img src="docs/screenshots/tutorial/dashboard-dark.png" alt="Dashboard in dark mode"></td>
<td><img src="docs/screenshots/tutorial/dashboard-mobile.png" alt="Dashboard on a phone" width="260"></td>
</tr>
</table>

Then open **Settings** and do these once:

1. **Restaurant**: name, currency (`INR`), timezone, logo, and your **UPI id** (see [section 5](#5-get-paid-with-upi)).
2. **This branch**: address, phone, GSTIN, **tax regime** (India GST, US Sales Tax, EU VAT or Spain IVA) and whether menu prices include tax.
3. **Staff** and **Roles**: one account per person, each with only the permissions they need.

![Settings](docs/screenshots/tutorial/settings.png)

<table>
<tr>
<td><img src="docs/screenshots/tutorial/settings-staff.png" alt="Staff"></td>
<td><img src="docs/screenshots/tutorial/settings-roles.png" alt="Roles and permissions"></td>
</tr>
</table>

## 3. Build your menu, tables and customers

Open each from the sidebar and press **Add**.

| Add this | Why | Screenshot |
| --- | --- | --- |
| **Menu**: categories, items, modifier groups (size, spice, add-ons) and combos | What the POS and the QR menu sell | ![Menu](docs/screenshots/tutorial/menu.png) |
| **Tables**: floors and tables, with a printable **QR code** per table | Dine-in orders, and guests ordering from their phone | ![Tables](docs/screenshots/tutorial/tables.png) |
| **Customers**: name, phone, allergies, birthday | Loyalty points, gift cards and repeat-visit history | ![Customers](docs/screenshots/tutorial/customers.png) |
| **Reservations**: bookings and a waitlist | Know who is coming, and when | ![Reservations](docs/screenshots/tutorial/reservations.png) |

## 4. Take an order

1. Open **Point of Sale**, pick a table (or choose **Takeaway** / **Delivery**).
2. Tap items. Items with options open a picker for crust, size, add-ons and so on.
3. Check the cart, then **Send to kitchen**. A ticket (KOT) goes to the right station.

<table>
<tr>
<td><img src="docs/screenshots/tutorial/pos-modifiers.png" alt="Modifier picker"></td>
<td><img src="docs/screenshots/tutorial/pos-cart.png" alt="Cart"></td>
</tr>
</table>

You do not have to take payment straight away. Tap **Back** to serve another table and come back to this bill later from **Tables** or **Orders**.

The checkout panel handles discounts, coupons, loyalty points, gift cards, tips and bill splitting. The server recalculates every amount, so the figure on the receipt is the figure that was charged.

![Checkout](docs/screenshots/tutorial/pos-checkout.png)

**Orders** lists every order with its status and shows what each guest ordered and paid.

![Orders](docs/screenshots/tutorial/orders.png)

The till works on a phone too:

![POS on a phone](docs/screenshots/tutorial/pos-mobile.png)

## 5. Get paid with UPI

OrderRestro builds a standard UPI payment link for the **exact amount due**. There is nothing to type in the customer's app, and no payment-gateway fees.

### Set up

1. Go to **Settings → Restaurant**.
2. Enter your **UPI id** (for example `yourshop@okbank`) and the **payee name** customers should see.
3. Save.

### Take a UPI payment

1. At checkout choose **UPI** as the payment method. A QR for the bill amount appears.
2. The same QR appears full-screen on the **customer display**.
3. The guest scans it with GPay, PhonePe, Paytm or any UPI app.
4. Check your UPI app or soundbox for the credit, then press **Complete payment**.

<table>
<tr>
<td><img src="docs/screenshots/tutorial/pos-checkout-upi.png" alt="UPI QR at checkout"></td>
<td><img src="docs/screenshots/tutorial/customer-display-upi.png" alt="UPI QR on the customer display"></td>
</tr>
</table>

When the payment is recorded, the till plays a **payment-received chime** and the customer display shows **Thank you** and plays it too.

<table>
<tr>
<td><img src="docs/screenshots/tutorial/pos-payment-done.png" alt="Payment recorded"></td>
<td><img src="docs/screenshots/tutorial/customer-display-paid.png" alt="Thank you screen"></td>
</tr>
</table>

> The app does not read your bank's confirmation. Pressing **Complete payment** is how a cashier confirms the money arrived, so always check your UPI app or soundbox first. Automatic confirmation needs a payment gateway, which is on the [roadmap](./ROADMAP.md).

### The customer display

1. On a second monitor or tablet, open `http://<server>:1995/customer-display`.
2. **Click or tap once anywhere** on that page. Browsers block sound until the page is touched.
3. Open it in the **same browser** as the POS, in another window. It follows the till live.

It shows a welcome screen when idle, the running order and total while you ring up, the UPI QR at payment, and a thank-you once paid.

![Customer display, idle](docs/screenshots/tutorial/customer-display.png)

## 6. Kitchen display

Open **Kitchen Display** (`/kds`) on a screen in the kitchen. Tickets appear in real time with a timer that warns after 15 minutes. Accept, mark preparing, then bump a ticket when it is ready. Use priority and reprint for rush orders and lost tickets.

![Kitchen display](docs/screenshots/tutorial/kitchen-display.png)

## 7. Staff, attendance and payroll

### Attendance

Staff **clock in and out** from **Attendance** and can request leave. Managers see everyone's hours and can correct a missed punch.

![Attendance](docs/screenshots/tutorial/attendance.png)

### Team: shifts, leave, payroll, performance

**Team** has four tabs.

| Tab | What it does | Screenshot |
| --- | --- | --- |
| **Schedule** | Weekly shifts per person. Clashing (overlapping) shifts are warned about. | ![Schedule](docs/screenshots/tutorial/team-schedule.png) |
| **Leave** | Managers approve or reject requests. Approved **unpaid** leave is deducted from payroll. | ![Leave](docs/screenshots/tutorial/team-leave.png) |
| **Payroll** | Set each person's pay (monthly or hourly), then run payroll for a period. | ![Payroll](docs/screenshots/tutorial/team-payroll.png) |
| **Performance** | Sales and orders per staff member. | ![Performance](docs/screenshots/tutorial/team-performance.png) |

**Run payroll**:

1. Under **Pay rates**, set each person to Monthly or Hourly and save.
2. Pick the period and press **Run payroll**. The draft is calculated from **clocked hours**, less approved unpaid leave.
3. Tips collected in the period are **split by hours worked**.
4. Review the lines, then **finalize**. Finalized runs feed the profit & loss report.

## 8. Inventory

**Inventory** tracks ingredients, with stock, reorder level and weighted-average cost.

![Inventory](docs/screenshots/tutorial/inventory.png)

| Screen | What it's for | Screenshot |
| --- | --- | --- |
| **Procurement** | Requests, quotations, invoices and payments to suppliers | ![Procurement](docs/screenshots/tutorial/inventory-procurement.png) |
| **Purchase orders** | Order stock, then receive it with batch and expiry | ![Purchase orders](docs/screenshots/tutorial/inventory-purchase-orders.png) |
| **Suppliers** | Contacts and terms | ![Suppliers](docs/screenshots/tutorial/inventory-suppliers.png) |
| **Waste** | Log spoilage, deducted first-in-first-out at the real batch cost | ![Waste](docs/screenshots/tutorial/inventory-waste.png) |
| **Transfers** | Move stock between branches | ![Transfers](docs/screenshots/tutorial/inventory-transfers.png) |

- **Recipes** link menu items to ingredients. Stock deducts at checkout, and a shortfall never blocks a sale.
- **Transfers** need at least two branches. Choose the ingredient, quantity and destination, then **Transfer**. The source is reduced first-in-first-out, and the destination gets a new batch at the same cost.

## 9. Accounting

Open **Accounting**. It has eight tabs.

![Accounting](docs/screenshots/tutorial/accounting.png)

| Tab | What it does | Screenshot |
| --- | --- | --- |
| **Expenses** | Record spending. Mark "paid from till" to count it in cash close. | ![Expenses](docs/screenshots/tutorial/accounting-expenses.png) |
| **Cash close** | Count the drawer at night. Shows expected cash and the variance. | ![Cash close](docs/screenshots/tutorial/accounting-cash-close.png) |
| **Profit & loss** | Net sales − expenses − payroll, for any range. | ![Profit and loss](docs/screenshots/tutorial/accounting-profit-loss.png) |
| **Balance sheet** | A snapshot of cash, inventory, unpaid supplier invoices and gift-card balances. A management view, **not** a statutory filing. | ![Balance sheet](docs/screenshots/tutorial/accounting-balance-sheet.png) |
| **Budgets** | A monthly budget per expense category, with spending against it. | ![Budgets](docs/screenshots/tutorial/accounting-budgets.png) |
| **Bank** | Import a bank statement CSV and match it to expenses. | ![Bank](docs/screenshots/tutorial/accounting-bank.png) |
| **GST** | Tax summary by rate. | ![GST](docs/screenshots/tutorial/accounting-gst.png) |
| **Branches** | Sales, open orders, low stock and inventory value across locations. | ![Branches](docs/screenshots/tutorial/accounting-branches.png) |

**Bank reconciliation**: download your statement as **CSV** (a date, a description and either one `amount` column, negative for money out, or `debit` and `credit` columns). In **Accounting → Bank**, choose **Import bank statement**. Money-out lines are auto-matched to expenses with the same amount within 5 days. Press **Match** to pick one yourself or **Ignore** for lines you do not track. Importing the same file twice is safe.

## 10. Reports, exports and scheduled emails

**Reports** has 18 reports: daily sales, sales by item, peak hours, food cost and margins, retention, tax, waste and more. Print them, or export as **Excel**, **PDF** or **CSV** (needs the `data.export` permission).

![Reports](docs/screenshots/tutorial/reports.png)

### Email a report on a schedule

1. Set `SMTP_URL` and `SMTP_FROM` on the server (any SMTP provider works).
2. Open **Reports** and scroll to **Email this report on a schedule**.
3. Choose daily, weekly or monthly, a format and the recipients.

Reports go out at 06:00 branch time: daily covers yesterday, weekly goes on Monday for the previous 7 days, and monthly goes on the 1st for the previous month. **Send now** tests a schedule straight away.

![Reports, full page with the schedule panel](docs/screenshots/tutorial/reports-full.png)

## 11. The other screens

| Screen | What it's for |
| --- | --- |
| **Marketing** | Coupons, happy-hour pricing and email campaigns. |
| **Delivery** | Delivery zones and the pickup-to-delivered status of delivery orders. |
| **Operations** | Documents (SOPs, contracts, recipes) and equipment maintenance. Use **Attach file** to add PDFs, images, text, Word or Excel files (5 MB each, up to 10 per document). |
| **Settings → Audit log** | Who did what, and when. |
| **Settings → Backup** | Schedule and restore backups. Test a restore before you need one. |
| **Settings → Security** | Two-factor sign-in and recovery codes. |
| **Settings → API keys, Webhooks** | Let other systems talk to OrderRestro. |
| **Settings → Updates** | Check for a new version. |

<table>
<tr>
<td><img src="docs/screenshots/tutorial/marketing-coupons.png" alt="Coupons"></td>
<td><img src="docs/screenshots/tutorial/marketing-happy-hour.png" alt="Happy hour"></td>
</tr>
<tr>
<td><img src="docs/screenshots/tutorial/marketing-campaigns.png" alt="Campaigns"></td>
<td><img src="docs/screenshots/tutorial/delivery.png" alt="Delivery"></td>
</tr>
<tr>
<td><img src="docs/screenshots/tutorial/operations.png" alt="Operations"></td>
<td><img src="docs/screenshots/tutorial/settings-audit-log.png" alt="Audit log"></td>
</tr>
<tr>
<td><img src="docs/screenshots/tutorial/settings-backup.png" alt="Backup"></td>
<td><img src="docs/screenshots/tutorial/settings-security.png" alt="Security"></td>
</tr>
<tr>
<td><img src="docs/screenshots/tutorial/settings-api-keys.png" alt="API keys"></td>
<td><img src="docs/screenshots/tutorial/settings-webhooks.png" alt="Webhooks"></td>
</tr>
</table>

![Updates](docs/screenshots/tutorial/settings-updates.png)

## 12. Connect other systems

OrderRestro has a REST API (`/api/v1`, docs at `/api/docs`), API keys, webhooks and an MCP server. See [docs/integrations-api.md](docs/integrations-api.md).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Login works, then "Unauthorized" | Using HTTPS? Set `COOKIE_SECURE=true`. Plain HTTP? Keep it `false`. |
| No UPI QR at checkout | Add a UPI id in **Settings → Restaurant** and save. |
| Customer display is silent | Tap the display page once so the browser allows sound. |
| Customer display does not follow the till | Open it in the **same browser profile** as the POS. |
| "Email is not set up" | Set `SMTP_URL` and `SMTP_FROM`, then restart the backend. |
| Transfer says unit mismatch | The destination stocks that ingredient in a different unit. Align the unit first. |

## Backups

Everything lives in your Postgres volume. Use **Settings → Backup** for scheduled backups, and test a restore before you need one.

Questions or bugs: [open an issue](https://github.com/Raktim94/nodedr-restaurant-pos/issues).

---

<sub>OrderRestro is developed by [NodeDR Infotech Private Limited](https://www.nodedr.com/) · [nodedr.com](https://www.nodedr.com/)</sub>
