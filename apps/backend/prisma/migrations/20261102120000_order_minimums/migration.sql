-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "onlineMinOrderAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "referralMinPurchase" DECIMAL(10,2) NOT NULL DEFAULT 200;
