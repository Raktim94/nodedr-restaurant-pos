-- Orders placed through the Integration API remember which key placed them, so
-- a website key can only read back its own orders (not staff, QR or other
-- websites' orders at the same location).
ALTER TABLE "orders" ADD COLUMN "integrationKeyId" TEXT;
ALTER TABLE "orders" ADD COLUMN "clientRequestHash" TEXT;
ALTER TABLE "integration_api_keys" ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_integrationKeyId_fkey"
  FOREIGN KEY ("integrationKeyId") REFERENCES "integration_api_keys"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "orders_integrationKeyId_idx" ON "orders"("integrationKeyId");
