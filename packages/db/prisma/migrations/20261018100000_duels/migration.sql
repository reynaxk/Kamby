-- CreateTable
CREATE TABLE "duels" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "challenger_id" TEXT NOT NULL,
    "opponent_id" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "challenger_pct" DOUBLE PRECISION,
    "opponent_pct" DOUBLE PRECISION,
    "winner_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duels_status_ends_at_idx" ON "duels"("status", "ends_at");

-- CreateIndex
CREATE INDEX "duels_challenger_id_created_at_idx" ON "duels"("challenger_id", "created_at");

-- CreateIndex
CREATE INDEX "duels_opponent_id_created_at_idx" ON "duels"("opponent_id", "created_at");

-- CreateIndex
CREATE INDEX "duels_winner_id_idx" ON "duels"("winner_id");

