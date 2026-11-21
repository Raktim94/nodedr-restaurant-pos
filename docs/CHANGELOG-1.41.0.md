# OrderRestro 1.41.0

- **Phone app, first start:** the app now asks plainly how you will use it: **Connect to my restaurant server** or **Use on this phone, no server**. Back returns to the choice; a phone already linked to a server goes straight in as before.
- **Add several tables at once (phone, no-server mode):** Tables > Edit tables > **+ Several**. Pick a name, a start number, how many and the seats; it shows the names it will make (T1 ... T12) and refuses the whole batch if any name already exists.
- **Credit sales (part payment):** the payment screen shows **Bill total, Customer pays now and Balance due** at the top, updating as you type. When money is left, one clear **Save sale · ₹400 on credit** button replaces the old two-button footer, the customer is marked required, and a duplicate "Exact" amount chip is gone. A **Nothing now** chip puts the whole bill on credit.
- **Money owed** now opens with the total to collect and how old it is (today, 1 to 30, 31 to 60, over 60 days).
- **Barcode scanner:** a hardware scanner works anywhere on the Sell screen (1.40.1), unchanged.
- **Server mode (Android):** files the web app makes (CSV error reports) are saved to the phone's Downloads, and download links (import templates, documents) go to the phone's download manager. Before, these buttons did nothing inside the app.
- **Database:** no migration.
