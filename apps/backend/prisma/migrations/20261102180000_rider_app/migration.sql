-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryFailedReason" TEXT,
ADD COLUMN     "pickedUpAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "riderLat" DOUBLE PRECISION,
ADD COLUMN     "riderLng" DOUBLE PRECISION,
ADD COLUMN     "riderLocationAt" TIMESTAMP(3),
ADD COLUMN     "riderOnline" BOOLEAN NOT NULL DEFAULT false;
