-- CreateTable
CREATE TABLE "dm_mutes" (
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_mutes_pkey" PRIMARY KEY ("user_id","conversation_id")
);

-- CreateIndex
CREATE INDEX "dm_mutes_conversation_id_idx" ON "dm_mutes"("conversation_id");

-- AddForeignKey
ALTER TABLE "dm_mutes" ADD CONSTRAINT "dm_mutes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

