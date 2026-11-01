-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "referralCode" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "requestedRedeemPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "referralEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referralReferredPoints" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "referralSharerPoints" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT NOT NULL,
    "sharedItemId" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "referrerPoints" INTEGER,
    "referredPoints" INTEGER,
    "qualifyingOrderId" TEXT,
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_ledger" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referralId" TEXT,
    "orderId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referredId_key" ON "referrals"("referredId");

-- CreateIndex
CREATE INDEX "referrals_referrerId_idx" ON "referrals"("referrerId");

-- CreateIndex
CREATE INDEX "referrals_branchId_status_idx" ON "referrals"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "points_ledger_idempotencyKey_key" ON "points_ledger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "points_ledger_customerId_createdAt_idx" ON "points_ledger"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_referralCode_key" ON "customers"("referralCode");

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
