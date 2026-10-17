-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DM_MESSAGE';

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "messages" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "dm_conversations" (
    "id" TEXT NOT NULL,
    "user_a_id" TEXT NOT NULL,
    "user_b_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "status" VARCHAR(8) NOT NULL DEFAULT 'request',
    "a_read_at" TIMESTAMP(3),
    "b_read_at" TIMESTAMP(3),
    "a_hidden_at" TIMESTAMP(3),
    "b_hidden_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dm_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "kind" VARCHAR(8) NOT NULL DEFAULT 'text',
    "body" VARCHAR(1000) NOT NULL DEFAULT '',
    "data" JSONB,
    "reactions" JSONB NOT NULL DEFAULT '{}',
    "tx_ref" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "dm_reports" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dm_conversations_user_a_id_last_message_at_idx" ON "dm_conversations"("user_a_id", "last_message_at");

-- CreateIndex
CREATE INDEX "dm_conversations_user_b_id_last_message_at_idx" ON "dm_conversations"("user_b_id", "last_message_at");

-- CreateIndex
CREATE INDEX "dm_conversations_requester_id_created_at_idx" ON "dm_conversations"("requester_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dm_conversations_user_a_id_user_b_id_key" ON "dm_conversations"("user_a_id", "user_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "dm_messages_tx_ref_key" ON "dm_messages"("tx_ref");

-- CreateIndex
CREATE INDEX "dm_messages_conversation_id_created_at_idx" ON "dm_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "dm_messages_sender_id_created_at_idx" ON "dm_messages"("sender_id", "created_at");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "dm_reports_conversation_id_reporter_id_key" ON "dm_reports"("conversation_id", "reporter_id");

-- AddForeignKey
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_reports" ADD CONSTRAINT "dm_reports_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

