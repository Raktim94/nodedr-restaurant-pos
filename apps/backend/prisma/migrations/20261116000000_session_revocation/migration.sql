-- Additive and nullable: existing sessions and rows are unaffected.
ALTER TABLE "users" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);
