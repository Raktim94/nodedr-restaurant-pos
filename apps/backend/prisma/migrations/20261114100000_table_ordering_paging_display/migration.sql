-- CreateEnum
CREATE TYPE "PayIntent" AS ENUM ('CASH', 'ONLINE');

-- CreateEnum
CREATE TYPE "BuzzerDriver" AS ENUM ('SIMULATED', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "BuzzerCallState" AS ENUM ('PENDING', 'SENT', 'ACKED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "AdKind" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "heldForPayment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payIntent" "PayIntent";

-- CreateTable
CREATE TABLE "public_order_keys" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_order_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buzzers" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "tableId" TEXT,
    "driver" "BuzzerDriver" NOT NULL DEFAULT 'SIMULATED',
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "deviceToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buzzers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buzzer_calls" (
    "id" TEXT NOT NULL,
    "buzzerId" TEXT NOT NULL,
    "orderId" TEXT,
    "tableId" TEXT,
    "state" "BuzzerCallState" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buzzer_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "display_terminals" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "idleSeconds" INTEGER NOT NULL DEFAULT 45,
    "thankYouSeconds" INTEGER NOT NULL DEFAULT 8,
    "adSlideSeconds" INTEGER NOT NULL DEFAULT 10,
    "adFit" TEXT NOT NULL DEFAULT 'contain',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "state" JSONB,
    "stateAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "display_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "display_ads" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "terminalId" TEXT,
    "kind" "AdKind" NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "durationSec" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "display_ads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_order_keys_branchId_key_key" ON "public_order_keys"("branchId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "buzzers_tableId_key" ON "buzzers"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "buzzers_deviceToken_key" ON "buzzers"("deviceToken");

-- CreateIndex
CREATE UNIQUE INDEX "buzzers_branchId_name_key" ON "buzzers"("branchId", "name");

-- CreateIndex
CREATE INDEX "buzzer_calls_buzzerId_state_idx" ON "buzzer_calls"("buzzerId", "state");

-- CreateIndex
CREATE INDEX "buzzer_calls_orderId_idx" ON "buzzer_calls"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "display_terminals_token_key" ON "display_terminals"("token");

-- CreateIndex
CREATE UNIQUE INDEX "display_terminals_branchId_name_key" ON "display_terminals"("branchId", "name");

-- CreateIndex
CREATE INDEX "display_ads_branchId_isActive_idx" ON "display_ads"("branchId", "isActive");

-- AddForeignKey
ALTER TABLE "buzzers" ADD CONSTRAINT "buzzers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzzer_calls" ADD CONSTRAINT "buzzer_calls_buzzerId_fkey" FOREIGN KEY ("buzzerId") REFERENCES "buzzers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "display_terminals" ADD CONSTRAINT "display_terminals_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "display_ads" ADD CONSTRAINT "display_ads_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

