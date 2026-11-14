-- Additive: new tables for secure NFC table tags and table access, two off-by-default restaurant switches, and
-- an optional opener on table sessions (automatic sessions have no staff opener). Existing rows are unaffected.
-- CreateEnum
CREATE TYPE "NfcTagStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'DISABLED');
-- CreateEnum
CREATE TYPE "NfcTagMode" AS ENUM ('SECURE', 'BASIC');
-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "autoTableSessions" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nfcTablesEnabled" BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE "table_sessions" ADD COLUMN     "openedVia" TEXT NOT NULL DEFAULT 'STAFF',
ALTER COLUMN "openedById" DROP NOT NULL;
-- CreateTable
CREATE TABLE "nfc_tags" (
    "id" TEXT NOT NULL,
    "publicRef" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "label" TEXT,
    "mode" "NfcTagMode" NOT NULL DEFAULT 'SECURE',
    "status" "NfcTagStatus" NOT NULL DEFAULT 'PROVISIONING',
    "uid" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "metaKeySealed" TEXT,
    "fileKeySealed" TEXT,
    "lastCounter" INTEGER NOT NULL DEFAULT -1,
    "lastAuthAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "replacesId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nfc_tags_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "nfc_taps" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "counter" INTEGER,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nfc_taps_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "table_accesses" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "tagId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "table_accesses_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "nfc_tags_publicRef_key" ON "nfc_tags"("publicRef");
-- CreateIndex
CREATE INDEX "nfc_tags_tableId_idx" ON "nfc_tags"("tableId");
-- CreateIndex
CREATE UNIQUE INDEX "nfc_tags_branchId_uid_key" ON "nfc_tags"("branchId", "uid");
-- CreateIndex
CREATE INDEX "nfc_taps_tagId_createdAt_idx" ON "nfc_taps"("tagId", "createdAt");
-- CreateIndex
CREATE INDEX "nfc_taps_branchId_createdAt_idx" ON "nfc_taps"("branchId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "table_accesses_tokenHash_key" ON "table_accesses"("tokenHash");
-- CreateIndex
CREATE INDEX "table_accesses_tableId_expiresAt_idx" ON "table_accesses"("tableId", "expiresAt");
-- AddForeignKey
ALTER TABLE "nfc_tags" ADD CONSTRAINT "nfc_tags_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "nfc_tags" ADD CONSTRAINT "nfc_tags_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "nfc_taps" ADD CONSTRAINT "nfc_taps_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "nfc_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "table_accesses" ADD CONSTRAINT "table_accesses_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
