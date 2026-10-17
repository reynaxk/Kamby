-- AlterTable
ALTER TABLE "dm_conversations" ADD COLUMN     "invite_code" VARCHAR(16),
ADD COLUMN     "is_community" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "dm_messages" ADD COLUMN     "channel_id" TEXT;

-- CreateTable
CREATE TABLE "dm_channels" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(8) NOT NULL DEFAULT 'text',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dm_channels_conversation_id_position_idx" ON "dm_channels"("conversation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "dm_conversations_invite_code_key" ON "dm_conversations"("invite_code");

-- CreateIndex
CREATE INDEX "dm_messages_channel_id_created_at_idx" ON "dm_messages"("channel_id", "created_at");

-- AddForeignKey
ALTER TABLE "dm_channels" ADD CONSTRAINT "dm_channels_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

