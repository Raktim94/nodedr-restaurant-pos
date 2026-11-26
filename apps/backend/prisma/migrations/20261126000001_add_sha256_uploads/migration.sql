-- Add sha256Uploads column to backups table for uploads archive integrity verification
ALTER TABLE "backups" ADD COLUMN "sha256Uploads" TEXT;
