-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "onlinePriceAdjustKind" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "onlinePriceAdjustValue" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryLat" DOUBLE PRECISION,
ADD COLUMN     "deliveryLng" DOUBLE PRECISION,
ADD COLUMN     "deliveryPlace" TEXT;
