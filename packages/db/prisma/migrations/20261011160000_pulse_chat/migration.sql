-- CreateTable
CREATE TABLE "pulse_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" VARCHAR(280) NOT NULL,
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulse_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pulse_messages_created_at_idx" ON "pulse_messages"("created_at");

-- CreateIndex
CREATE INDEX "pulse_messages_user_id_created_at_idx" ON "pulse_messages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "pulse_messages" ADD CONSTRAINT "pulse_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

