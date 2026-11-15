-- CreateEnum
CREATE TYPE "StockJournalType" AS ENUM ('TRANSFER', 'WASTE', 'CORRECTION');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "journalEntryId" TEXT;

-- CreateTable
CREATE TABLE "stock_journal_entries" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "entryNo" TEXT NOT NULL,
    "type" "StockJournalType" NOT NULL,
    "status" "ProductionStatus" NOT NULL DEFAULT 'DRAFT',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "stock_journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_journal_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "direction" TEXT NOT NULL,
    "enteredQuantity" DECIMAL(12,3) NOT NULL,
    "enteredUnit" "IngredientUnit" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "fromLocationId" TEXT,
    "fromLocationName" TEXT,
    "toLocationId" TEXT,
    "toLocationName" TEXT,
    "wasteReason" "WasteReason",
    "note" TEXT,
    "unitCost" DECIMAL(14,4),
    "wasteEntryId" TEXT,

    CONSTRAINT "stock_journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_journal_entries_branchId_occurredAt_idx" ON "stock_journal_entries"("branchId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_journal_entries_branchId_entryNo_key" ON "stock_journal_entries"("branchId", "entryNo");

-- CreateIndex
CREATE UNIQUE INDEX "stock_journal_entries_branchId_idempotencyKey_key" ON "stock_journal_entries"("branchId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "stock_journal_lines_entryId_idx" ON "stock_journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "stock_journal_lines_ingredientId_idx" ON "stock_journal_lines"("ingredientId");

-- CreateIndex
CREATE INDEX "stock_movements_journalEntryId_idx" ON "stock_movements"("journalEntryId");

-- AddForeignKey
ALTER TABLE "stock_journal_entries" ADD CONSTRAINT "stock_journal_entries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_journal_lines" ADD CONSTRAINT "stock_journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "stock_journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_journal_lines" ADD CONSTRAINT "stock_journal_lines_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
