-- AlterTable
ALTER TABLE "production_entries" ADD COLUMN     "allocationMethod" TEXT,
ADD COLUMN     "recipeId" TEXT,
ADD COLUMN     "recipeKind" TEXT,
ADD COLUMN     "recipeName" TEXT,
ADD COLUMN     "recipeSnapshot" JSONB,
ADD COLUMN     "sourcePoId" TEXT,
ADD COLUMN     "sourcePoNumber" TEXT,
ADD COLUMN     "sourceSupplier" TEXT;

-- AlterTable
ALTER TABLE "production_lines" ADD COLUMN     "allocatedCost" DECIMAL(16,4),
ADD COLUMN     "allocationPercent" DECIMAL(7,3),
ADD COLUMN     "directToIngredientId" TEXT,
ADD COLUMN     "expectedQuantity" DECIMAL(12,3),
ADD COLUMN     "goodUnitCost" DECIMAL(14,4),
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "locationName" TEXT,
ADD COLUMN     "lotNumber" TEXT,
ADD COLUMN     "rejectedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "locationId" TEXT;

-- CreateTable
CREATE TABLE "product_recipes" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "outputIngredientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseOutputQty" DECIMAL(12,3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_recipe_lines" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "IngredientUnit" NOT NULL,

    CONSTRAINT "product_recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_recipes_branchId_outputIngredientId_idx" ON "product_recipes"("branchId", "outputIngredientId");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipes_branchId_outputIngredientId_name_key" ON "product_recipes"("branchId", "outputIngredientId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipe_lines_recipeId_ingredientId_key" ON "product_recipe_lines"("recipeId", "ingredientId");

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_outputIngredientId_fkey" FOREIGN KEY ("outputIngredientId") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_lines" ADD CONSTRAINT "product_recipe_lines_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "product_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_lines" ADD CONSTRAINT "product_recipe_lines_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

