-- Additive: discount cap + reason. Defaults keep existing behaviour (no cap, reason optional).
ALTER TABLE "restaurants" ADD COLUMN "maxManualDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 100;
ALTER TABLE "restaurants" ADD COLUMN "requireDiscountReason" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN "discountReason" TEXT;
