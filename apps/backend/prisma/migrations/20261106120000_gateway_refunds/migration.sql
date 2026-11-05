-- CreateEnum
CREATE TYPE "GatewayRefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "gateway_refunds" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "gatewayPaymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "GatewayRefundStatus" NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "refundId" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gateway_refunds_gatewayPaymentId_idx" ON "gateway_refunds"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "gateway_refunds_orderId_idx" ON "gateway_refunds"("orderId");

-- AddForeignKey
ALTER TABLE "gateway_refunds" ADD CONSTRAINT "gateway_refunds_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

