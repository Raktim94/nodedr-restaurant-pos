# OrderRestro 1.39.1

- **Stock Journal: produce menu items directly.** The finished-product picker now lists your menu items (Fried Rice, Momo...). Picking one that has no stock item asks to confirm, then creates a stock item with the same name and links it to the menu item (one per sale). Menu price and tax are not changed.
- **Existing finished products** that are not on the POS menu can be put on it from the voucher (you type category, price and tax).
- **New role: Stock Journal Manager** and permission `journal.manage`. The role runs every kind of journal entry (production, transfer, waste, correction), quality checks, reversals and reports, and can link menu items to stock; it cannot manage suppliers, purchasing, recipes, sales or the menu. Whoever already has "Manage Inventory" gets the new permission automatically. Existing restaurants get the role created on the next start; admins can edit it like any role.
- Security: Next.js 16.4.5 (shipped in 1.39.0).
- No database migrations.
