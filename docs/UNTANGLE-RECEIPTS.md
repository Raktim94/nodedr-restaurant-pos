# Goods receipt consistency decision log

## Serialize document numbering and mutable stock reads within the transaction

- `goods-receipts.service.ts` previously counted receipts outside the transaction. Concurrent receipts could generate the same document number.
- Ingredient balances and costs were fetched before the transaction, and the comment incorrectly assumed a Prisma read acquired a row lock. Concurrent receipts/checkouts could overwrite stock totals and weighted costs.
- Purchase order quantities and status were also captured before the transaction. Concurrent receipts could lose received quantities; cancellation could race with receipt posting.

Fix: acquire a branch row lock before allocating GRN numbers, lock the linked PO before reading it, then lock ingredient rows in stable ID order before reading balances. Keep all writes in that transaction. PO status changes use the same PO lock before validating transitions. Existing receipt behavior and precision are preserved.

Validation: focused tests simulate changed balances/status after lock acquisition and check multiple receipt lines accumulate correctly. Database integration concurrency testing still requires PostgreSQL.

## Purchase order numbering

- PO creation had the same pre-transaction count race as receipts.
- Fix: use the branch document-number lock, count POs after acquiring it, and create the PO and its lines in the same transaction. A regression test models a competing creation completing while the lock is awaited.
