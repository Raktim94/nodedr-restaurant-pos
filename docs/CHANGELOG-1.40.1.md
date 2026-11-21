# OrderRestro 1.40.1

- **Barcode scanner (phone and standalone POS):** a USB or Bluetooth scanner now works anywhere on the Sell screen, not only while the search box has focus. Before, a scan that arrived while a dish button was focused did nothing (or pressed that button). Scanners that end the code with Tab work too, and codes match regardless of letter case. An unknown code now says so. Slow typing is never taken for a scan.
- **Web POS:** scanning a barcode or SKU adds the item (menu barcode, menu SKU, or the SKU / barcode of the stock ingredient the item deducts from). Archived items no longer show in the POS or the Menu page.
- **Recipes:** a duplicate ingredient on a recipe is added together instead of rejected.
- **Deleting a menu item** that appears in past orders now archives it (keeps sales history and receipts intact); an item never sold is removed.
- **AI Operations Copilot (new, off until `GEMINI_API_KEY` is set):** actions respect the signed-in user's permissions, restaurant and branch; staff accounts cannot be created above the caller's own access; temporary passwords are random; the larger request size applies to the AI route only.
- **Security:** pinned `effect` to a patched version (ReDoS advisory reached through Prisma).
- **Database:** no migration.
