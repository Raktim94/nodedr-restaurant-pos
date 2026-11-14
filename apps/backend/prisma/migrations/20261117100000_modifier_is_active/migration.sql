-- Additive. An option that past orders used cannot be deleted (order history keeps pointing at it), so removing it from a
-- menu item hides it instead. Every existing option stays active.
ALTER TABLE "modifiers" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
