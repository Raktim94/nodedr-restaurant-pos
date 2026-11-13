-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ProductionLineRole" AS ENUM ('INPUT', 'OUTPUT');

-- CreateEnum
CREATE TYPE "WasteKind" AS ENUM ('INGREDIENT', 'FINISHED');

-- CreateEnum
CREATE TYPE "WasteStatus" AS ENUM ('POSTED', 'PENDING_APPROVAL', 'REJECTED', 'REVERSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'OPENING';
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_USE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WasteReason" ADD VALUE 'RETURNED_PLATE';
ALTER TYPE "WasteReason" ADD VALUE 'PREP_TRIM';
ALTER TYPE "WasteReason" ADD VALUE 'STORAGE_TEMPERATURE';

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "category" TEXT,
ADD COLUMN     "storageLocation" TEXT,
ADD COLUMN     "wasteApprovalQty" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "productionEntryId" TEXT,
ADD COLUMN     "wasteEntryId" TEXT;

-- AlterTable
ALTER TABLE "waste_logs" ADD COLUMN     "entryId" TEXT;

-- CreateTable
CREATE TABLE "production_entries" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "entryNo" TEXT NOT NULL,
    "status" "ProductionStatus" NOT NULL DEFAULT 'DRAFT',
    "producedAt" TIMESTAMP(3) NOT NULL,
    "shift" TEXT,
    "location" TEXT,
    "batchRef" TEXT,
    "notes" TEXT,
    "responsibleId" TEXT,
    "idempotencyKey" TEXT,
    "deviceId" TEXT,
    "correctsEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "production_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "role" "ProductionLineRole" NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "enteredQuantity" DECIMAL(12,3) NOT NULL,
    "enteredUnit" "IngredientUnit" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_entries" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "WasteKind" NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "enteredQuantity" DECIMAL(12,3) NOT NULL,
    "enteredUnit" "IngredientUnit" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "reason" "WasteReason" NOT NULL,
    "shift" TEXT,
    "location" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "includedInProduction" BOOLEAN NOT NULL DEFAULT false,
    "productionEntryId" TEXT,
    "status" "WasteStatus" NOT NULL DEFAULT 'POSTED',
    "idempotencyKey" TEXT,
    "deviceId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reverseReason" TEXT,

    CONSTRAINT "waste_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_entries_branchId_producedAt_idx" ON "production_entries"("branchId", "producedAt");

-- CreateIndex
CREATE UNIQUE INDEX "production_entries_branchId_entryNo_key" ON "production_entries"("branchId", "entryNo");

-- CreateIndex
CREATE UNIQUE INDEX "production_entries_branchId_idempotencyKey_key" ON "production_entries"("branchId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "production_lines_entryId_idx" ON "production_lines"("entryId");

-- CreateIndex
CREATE INDEX "production_lines_ingredientId_idx" ON "production_lines"("ingredientId");

-- CreateIndex
CREATE INDEX "waste_entries_branchId_occurredAt_idx" ON "waste_entries"("branchId", "occurredAt");

-- CreateIndex
CREATE INDEX "waste_entries_ingredientId_idx" ON "waste_entries"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "waste_entries_branchId_idempotencyKey_key" ON "waste_entries"("branchId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "stock_movements_productionEntryId_idx" ON "stock_movements"("productionEntryId");

-- CreateIndex
CREATE INDEX "stock_movements_wasteEntryId_idx" ON "stock_movements"("wasteEntryId");

-- CreateIndex
CREATE INDEX "stock_movements_branchId_createdAt_idx" ON "stock_movements"("branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "waste_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_correctsEntryId_fkey" FOREIGN KEY ("correctsEntryId") REFERENCES "production_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "production_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "verifactu_records_chain_key" RENAME TO "verifactu_records_restaurantId_issuerNif_environment_seq_key";

-- RenameIndex
ALTER INDEX "verifactu_records_number_key" RENAME TO "verifactu_records_restaurantId_issuerNif_environment_invoic_key";
