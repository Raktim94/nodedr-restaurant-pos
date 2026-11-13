-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "clockInKey" TEXT,
ADD COLUMN     "clockOutKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "attendance_userId_clockInKey_key" ON "attendance"("userId", "clockInKey");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_userId_clockOutKey_key" ON "attendance"("userId", "clockOutKey");

