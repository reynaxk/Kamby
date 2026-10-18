-- Open duels (2026-10-18): a duel can wait in the lobby with no opponent yet.
ALTER TABLE "duels" ALTER COLUMN "opponent_id" DROP NOT NULL;
CREATE INDEX "duels_status_created_at_idx" ON "duels"("status", "created_at");
