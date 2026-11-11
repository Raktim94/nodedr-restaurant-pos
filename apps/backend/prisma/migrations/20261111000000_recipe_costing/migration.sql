-- Recipe costing (additive only: every new column has a default or is nullable, so existing
-- ingredients, recipes, stock and orders behave exactly as before).

-- CreateEnum
CREATE TYPE "IngredientKind" AS ENUM ('PURCHASED', 'PREPARED');

-- CreateEnum
CREATE TYPE "IngredientCostMethod" AS ENUM ('AVERAGE', 'MANUAL', 'RECIPE');

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION';

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "conversions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "costMethod" "IngredientCostMethod" NOT NULL DEFAULT 'AVERAGE',
ADD COLUMN     "kind" "IngredientKind" NOT NULL DEFAULT 'PURCHASED',
ADD COLUMN     "purchasePrice" DECIMAL(12,2),
ADD COLUMN     "purchaseQuantity" DECIMAL(12,3),
ADD COLUMN     "purchaseUnit" "IngredientUnit",
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "yieldPercent" DECIMAL(5,2) NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "portion" TEXT,
ADD COLUMN     "portionRatio" DECIMAL(5,3) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "recipe_ingredients" ADD COLUMN     "unit" "IngredientUnit";

-- CreateTable
CREATE TABLE "order_item_costs" (
    "orderItemId" TEXT NOT NULL,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_costs_pkey" PRIMARY KEY ("orderItemId")
);

-- AddForeignKey
ALTER TABLE "order_item_costs" ADD CONSTRAINT "order_item_costs_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "menu_item_costings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "batchOutputQty" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "overheads" JSONB NOT NULL DEFAULT '[]',
    "halfPortionRatio" DECIMAL(5,3) NOT NULL DEFAULT 0.5,
    "targetMarginPercent" DECIMAL(5,2),
    "targetMarkupPercent" DECIMAL(7,2),
    "alertDropPoints" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "baselineCost" DECIMAL(12,4),
    "baselineAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_costings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_ingredients" (
    "id" TEXT NOT NULL,
    "modifierId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "IngredientUnit",

    CONSTRAINT "modifier_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preparations" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "outputIngredientId" TEXT NOT NULL,
    "batchOutputQty" DECIMAL(12,3) NOT NULL,
    "overheads" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preparations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preparation_lines" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "IngredientUnit",

    CONSTRAINT "preparation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_runs" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "batches" DECIMAL(12,3) NOT NULL,
    "outputQty" DECIMAL(12,3) NOT NULL,
    "ingredientCost" DECIMAL(12,4) NOT NULL,
    "overheadCost" DECIMAL(12,4) NOT NULL,
    "totalCost" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "menu_item_costings_menuItemId_key" ON "menu_item_costings"("menuItemId");

-- CreateIndex
CREATE INDEX "menu_item_costings_branchId_idx" ON "menu_item_costings"("branchId");

-- CreateIndex
CREATE INDEX "modifier_ingredients_modifierId_idx" ON "modifier_ingredients"("modifierId");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_ingredients_modifierId_ingredientId_key" ON "modifier_ingredients"("modifierId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "preparations_outputIngredientId_key" ON "preparations"("outputIngredientId");

-- CreateIndex
CREATE INDEX "preparations_branchId_idx" ON "preparations"("branchId");

-- CreateIndex
CREATE INDEX "preparation_lines_preparationId_idx" ON "preparation_lines"("preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "preparation_lines_preparationId_ingredientId_key" ON "preparation_lines"("preparationId", "ingredientId");

-- CreateIndex
CREATE INDEX "production_runs_preparationId_createdAt_idx" ON "production_runs"("preparationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "production_runs_branchId_idempotencyKey_key" ON "production_runs"("branchId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "menu_item_costings" ADD CONSTRAINT "menu_item_costings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_costings" ADD CONSTRAINT "menu_item_costings_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_ingredients" ADD CONSTRAINT "modifier_ingredients_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "modifiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_ingredients" ADD CONSTRAINT "modifier_ingredients_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparations" ADD CONSTRAINT "preparations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparations" ADD CONSTRAINT "preparations_outputIngredientId_fkey" FOREIGN KEY ("outputIngredientId") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_lines" ADD CONSTRAINT "preparation_lines_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "preparations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_lines" ADD CONSTRAINT "preparation_lines_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "preparations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
