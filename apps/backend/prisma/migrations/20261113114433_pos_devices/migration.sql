-- CreateTable
CREATE TABLE "pos_devices" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "appVersion" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "pos_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_devices_userId_idx" ON "pos_devices"("userId");

-- CreateIndex
CREATE INDEX "pos_devices_deviceId_idx" ON "pos_devices"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_devices_restaurantId_deviceId_key" ON "pos_devices"("restaurantId", "deviceId");

-- AddForeignKey
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
