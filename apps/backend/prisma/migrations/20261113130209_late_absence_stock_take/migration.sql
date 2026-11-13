-- AlterTable
ALTER TABLE "payroll_lines" ADD COLUMN     "absenceDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "absentDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lateMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "staff_pay" ADD COLUMN     "deductAbsence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lateGraceMinutes" INTEGER;

-- CreateTable
CREATE TABLE "stock_takes" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "area" TEXT,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "deviceId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lines" JSONB NOT NULL,

    CONSTRAINT "stock_takes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_takes_branchId_takenAt_idx" ON "stock_takes"("branchId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_takes_branchId_idempotencyKey_key" ON "stock_takes"("branchId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
