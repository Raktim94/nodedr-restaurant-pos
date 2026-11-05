-- CreateEnum
CREATE TYPE "GatewayMode" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "GatewayPaymentStatus" AS ENUM ('CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "payment_gateway_catalog" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT[],
    "integration" TEXT NOT NULL,
    "docsUrl" TEXT NOT NULL,
    "adapter" TEXT,
    "notes" TEXT,
    "sources" TEXT[],
    "researchedAt" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_gateway_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_gateway_connections" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" "GatewayMode" NOT NULL DEFAULT 'TEST',
    "liveConfirmedAt" TIMESTAMP(3),
    "liveConfirmedById" TEXT,
    "testCredentialsEnc" TEXT,
    "liveCredentialsEnc" TEXT,
    "testKeys" TEXT[],
    "liveKeys" TEXT[],
    "lastError" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_gateway_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_payments" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" "GatewayMode" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "GatewayPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "providerRef" TEXT,
    "providerPaymentId" TEXT,
    "checkoutUrl" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" "GatewayMode" NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateway_catalog_restaurantId_key_key" ON "payment_gateway_catalog"("restaurantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateway_connections_restaurantId_provider_key" ON "payment_gateway_connections"("restaurantId", "provider");

-- CreateIndex
CREATE INDEX "gateway_payments_orderId_idx" ON "gateway_payments"("orderId");

-- CreateIndex
CREATE INDEX "gateway_payments_restaurantId_status_idx" ON "gateway_payments"("restaurantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_payments_provider_mode_providerRef_key" ON "gateway_payments"("provider", "mode", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_webhook_events_provider_mode_eventId_key" ON "gateway_webhook_events"("provider", "mode", "eventId");

-- AddForeignKey
ALTER TABLE "payment_gateway_catalog" ADD CONSTRAINT "payment_gateway_catalog_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_gateway_connections" ADD CONSTRAINT "payment_gateway_connections_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

