-- CreateEnum
CREATE TYPE "TableSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- AlterTable
ALTER TABLE "production_entries" ADD COLUMN     "additionalCost" DECIMAL(14,4),
ADD COLUMN     "costed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "expectedPrice" DECIMAL(12,2),
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "ingredientCost" DECIMAL(14,4),
ADD COLUMN     "manufacturedOn" TIMESTAMP(3),
ADD COLUMN     "priceChangeId" TEXT,
ADD COLUMN     "priceMenuItemId" TEXT,
ADD COLUMN     "proposedPrice" DECIMAL(12,2),
ADD COLUMN     "totalCost" DECIMAL(14,4),
ADD COLUMN     "unitCost" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "production_lines" ADD COLUMN     "lineCost" DECIMAL(16,4),
ADD COLUMN     "unitRate" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "manufacturingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireTableSession" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "production_costs" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "production_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_price_changes" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "oldPrice" DECIMAL(12,2) NOT NULL,
    "newPrice" DECIMAL(12,2) NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'STOCK_JOURNAL',
    "productionEntryId" TEXT,
    "unitCostAtChange" DECIMAL(14,4),

    CONSTRAINT "menu_price_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_sessions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" "TableSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "codeHash" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "failedTries" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "table_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_session_grants" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_session_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_ratings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_costs_entryId_idx" ON "production_costs"("entryId");

-- CreateIndex
CREATE INDEX "menu_price_changes_branchId_changedAt_idx" ON "menu_price_changes"("branchId", "changedAt");

-- CreateIndex
CREATE INDEX "menu_price_changes_menuItemId_changedAt_idx" ON "menu_price_changes"("menuItemId", "changedAt");

-- CreateIndex
CREATE INDEX "table_sessions_tableId_status_idx" ON "table_sessions"("tableId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "table_session_grants_tokenHash_key" ON "table_session_grants"("tokenHash");

-- CreateIndex
CREATE INDEX "table_session_grants_sessionId_idx" ON "table_session_grants"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "order_ratings_orderId_key" ON "order_ratings"("orderId");

-- CreateIndex
CREATE INDEX "order_ratings_branchId_createdAt_idx" ON "order_ratings"("branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "production_costs" ADD CONSTRAINT "production_costs_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "production_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_session_grants" ADD CONSTRAINT "table_session_grants_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "table_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

