-- CreateEnum
CREATE TYPE "TicketMode" AS ENUM ('KDS', 'BILL_ONLY');

-- AlterTable: KDS is the default so existing installations keep their
-- current kitchen-ticket behaviour; opt in to BILL_ONLY per branch.
ALTER TABLE "branches" ADD COLUMN "ticketMode" "TicketMode" NOT NULL DEFAULT 'KDS';
