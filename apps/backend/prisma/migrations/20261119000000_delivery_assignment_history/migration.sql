-- CreateTable
CREATE TABLE "delivery_assignments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fromDriverId" TEXT,
    "toDriverId" TEXT,
    "reason" TEXT,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_assignments_orderId_createdAt_idx" ON "delivery_assignments"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "delivery_assignments_branchId_createdAt_idx" ON "delivery_assignments"("branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
