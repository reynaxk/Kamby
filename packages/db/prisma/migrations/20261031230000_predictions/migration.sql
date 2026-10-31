-- CreateTable
CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "options" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "resolution_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chain_identifier" TEXT,
    "token_address" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "resolved_option_index" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "live_room_id" TEXT,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_votes" (
    "prediction_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "option_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_votes_pkey" PRIMARY KEY ("prediction_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "predictions_dedupe_key_key" ON "predictions"("dedupe_key");
CREATE INDEX "predictions_status_expires_at_idx" ON "predictions"("status", "expires_at");
CREATE INDEX "predictions_created_at_idx" ON "predictions"("created_at");
CREATE INDEX "prediction_votes_user_id_created_at_idx" ON "prediction_votes"("user_id", "created_at");
CREATE INDEX "prediction_votes_created_at_idx" ON "prediction_votes"("created_at");

-- AddForeignKey
ALTER TABLE "prediction_votes" ADD CONSTRAINT "prediction_votes_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
