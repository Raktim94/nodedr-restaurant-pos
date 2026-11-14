-- Additive and nullable: existing batches simply show "Not recorded" for quality and no price snapshot.
ALTER TABLE "production_entries"
  ADD COLUMN "menuItemId" TEXT,
  ADD COLUMN "sellingPriceAtPost" DECIMAL(12,2),
  ADD COLUMN "qualityResult" TEXT,
  ADD COLUMN "qualityGrade" TEXT,
  ADD COLUMN "qualityNotes" TEXT,
  ADD COLUMN "qualityById" TEXT,
  ADD COLUMN "qualityAt" TIMESTAMP(3);
