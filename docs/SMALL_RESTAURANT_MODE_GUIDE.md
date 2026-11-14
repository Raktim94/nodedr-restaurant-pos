# Small restaurant mode

OrderRestro is useful with nothing advanced switched on. Advanced features are separate switches, off by default, and never
required.

## Basic mode (default)
- Standard POS, order management, tables, KDS, billing, simple reports.
- Table ordering by QR: guests scan the table QR and enter the 6-character code staff give them. Cash or UPI recorded by staff.
- No special hardware. Works on one cheap laptop/phone and a printer.

## Advanced mode (optional, two independent switches)
Tables > **Ordering mode & NFC tags**:
1. **Secure NFC tags**: guests tap an NTAG 424 DNA card instead of entering a code. Ordinary NFC cards remain low-security QR links.
2. **Open and close tables automatically**: the first valid guest order opens the table; settling closes it. Needs switch 1.
The **Live board** (Tables > Live board) shows every table's state for the whole floor.

Not part of "Advanced mode", already optional elsewhere: offline phone POS, multi-branch, payment gateways, manufacturing costs.

## Starting from nothing (about ten minutes)
1. Create the restaurant (sign-up on a new server). 2. Tables > add floors and tables. 3. Menu > add items; open an item to add
**Options** (Size, Extras) if it has them. 4. Settings > billing/tax and payment methods. 5. Tables > Table cards: print the QR
for each table. 6. Place a test order from a phone. 7. Start taking orders. NFC is only a later upgrade.

## Turning Advanced off
Switch the two settings off. Nothing is deleted; tags, taps and old sessions stay. Guests return to QR + code immediately.
