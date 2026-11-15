-- Phone (standalone POS) books reach the server: refunds and expenses carry the phone's event id so a re-send is
-- harmless, and each phone's own day-end cash count is kept. Additive only.
ALTER TABLE "refunds" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "refunds_clientRequestId_key" ON "refunds"("clientRequestId");

ALTER TABLE "expenses" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "expenses_clientRequestId_key" ON "expenses"("clientRequestId");

CREATE TABLE "phone_till_closings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "openingFloat" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashSales" DECIMAL(12,2) NOT NULL,
    "cashRefunds" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashExpenses" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expectedCash" DECIMAL(12,2) NOT NULL,
    "countedCash" DECIMAL(12,2) NOT NULL,
    "variance" DECIMAL(12,2) NOT NULL,
    "netSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closedByName" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "syncedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "phone_till_closings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "phone_till_closings_branchId_deviceId_businessDate_key" ON "phone_till_closings"("branchId", "deviceId", "businessDate");
CREATE INDEX "phone_till_closings_branchId_businessDate_idx" ON "phone_till_closings"("branchId", "businessDate");
ALTER TABLE "phone_till_closings" ADD CONSTRAINT "phone_till_closings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
