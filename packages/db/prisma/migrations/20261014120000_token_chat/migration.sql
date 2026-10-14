-- AlterTable
ALTER TABLE "pulse_messages" ADD COLUMN     "badges" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "kind" VARCHAR(8) NOT NULL DEFAULT 'text',
ADD COLUMN     "pnl" JSONB,
ADD COLUMN     "report_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "token_key" VARCHAR(140);

-- CreateTable
CREATE TABLE "pulse_reports" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pulse_messages_token_key_created_at_idx" ON "pulse_messages"("token_key", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "pulse_reports_message_id_user_id_key" ON "pulse_reports"("message_id", "user_id");

-- AddForeignKey
ALTER TABLE "pulse_reports" ADD CONSTRAINT "pulse_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "pulse_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_reports" ADD CONSTRAINT "pulse_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
