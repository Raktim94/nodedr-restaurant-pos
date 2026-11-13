-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "breakMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll_lines" ADD COLUMN     "calcInputs" JSONB,
ADD COLUMN     "overtimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "overtimePay" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "staff_pay" ADD COLUMN     "overtimeAfterHours" DECIMAL(5,2),
ADD COLUMN     "overtimeMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.5;
