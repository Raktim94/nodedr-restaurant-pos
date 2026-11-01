-- Additive: manual adjustments on payroll lines, and a PAID state with who/when/how.
ALTER TYPE "PayrollStatus" ADD VALUE IF NOT EXISTS 'PAID';

ALTER TABLE "payroll_runs" ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "paidById" TEXT,
ADD COLUMN "paymentMethod" TEXT,
ADD COLUMN "paymentRef" TEXT;

ALTER TABLE "payroll_lines" ADD COLUMN "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "advanceRecovery" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "otherDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "adjustmentNote" TEXT;
