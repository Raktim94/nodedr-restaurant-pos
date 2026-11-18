-- A retried Stock Journal receipt must not create a second batch and add
-- stock twice. Unique per branch; NULL means "not a keyed receipt".
ALTER TABLE "stock_batches" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "stock_batches_branchId_idempotencyKey_key"
  ON "stock_batches"("branchId", "idempotencyKey");
