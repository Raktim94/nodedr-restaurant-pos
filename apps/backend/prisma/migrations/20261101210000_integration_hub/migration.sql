-- Additive: integrations hub + external order references.
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONNECTED', 'PENDING_CONFIGURATION', 'CONNECTED', 'SYNC_ERROR', 'AUTH_EXPIRED', 'DISABLED');

CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING_CONFIGURATION',
    "externalAccountId" TEXT,
    "credentialsEnc" TEXT,
    "config" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_logs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_connections_restaurantId_provider_key" ON "integration_connections"("restaurantId", "provider");
CREATE INDEX "integration_logs_connectionId_createdAt_idx" ON "integration_logs"("connectionId", "createdAt");

ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_logs" ADD CONSTRAINT "integration_logs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD COLUMN "externalSource" TEXT,
ADD COLUMN "externalOrderId" TEXT,
ADD COLUMN "externalCustomerRef" TEXT;

CREATE UNIQUE INDEX "orders_branchId_externalSource_externalOrderId_key" ON "orders"("branchId", "externalSource", "externalOrderId");
