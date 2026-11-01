-- Additive: several saved delivery addresses per customer.
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "street" TEXT,
    "landmark" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "instructions" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the old single free-text address over as each customer's default address.
INSERT INTO "customer_addresses" ("id", "customerId", "line1", "isDefault", "updatedAt")
SELECT 'ca_' || "id", "id", "address", true, CURRENT_TIMESTAMP
FROM "customers" WHERE "address" IS NOT NULL AND btrim("address") <> '';
