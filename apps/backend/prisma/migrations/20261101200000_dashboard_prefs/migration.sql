-- Additive: per-user dashboard layout.
ALTER TABLE "users" ADD COLUMN "dashboardPrefs" JSONB;
