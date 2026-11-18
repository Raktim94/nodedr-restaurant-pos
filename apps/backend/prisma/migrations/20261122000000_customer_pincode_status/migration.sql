-- Additive: optional PIN code and a status label. Existing customers become ACTIVE with no PIN code.
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');
ALTER TABLE "customers" ADD COLUMN "pincode" TEXT,
ADD COLUMN "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE';
