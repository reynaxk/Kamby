-- Phase 7: referral program. See docs/REFERRALS.md. Purely additive — no existing table's
-- existing behavior changes. `referral_code` is backfilled for every existing user before
-- being made NOT NULL/UNIQUE, since it can't be added with a fixed default on a non-empty
-- table. Derived from each row's own id (already globally unique) plus a random salt, so
-- collisions across even many thousands of rows are not a real risk without needing a
-- retry loop here.

-- AlterTable: add nullable first
ALTER TABLE "users" ADD COLUMN "referral_code" TEXT;
ALTER TABLE "users" ADD COLUMN "referred_by_user_id" TEXT;

-- Backfill every existing row with a unique 8-character code
UPDATE "users"
SET "referral_code" = lower(substr(md5(id || random()::text), 1, 8))
WHERE "referral_code" IS NULL;

-- Now safe to enforce NOT NULL + UNIQUE
ALTER TABLE "users" ALTER COLUMN "referral_code" SET NOT NULL;
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- FK for referred_by_user_id — Restrict (the schema.prisma default), not Cascade/SetNull:
-- a referrer row must not be deletable while still credited with referrals, so a delete
-- attempt surfaces that conflict instead of silently orphaning the referral relationship.
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_fkey"
  FOREIGN KEY ("referred_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "users_referred_by_user_id_idx" ON "users"("referred_by_user_id");
