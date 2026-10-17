-- AlterTable
ALTER TABLE "dm_conversations" ADD COLUMN     "is_group" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "owner_id" TEXT,
ADD COLUMN     "title" VARCHAR(40),
ALTER COLUMN "user_a_id" DROP NOT NULL,
ALTER COLUMN "user_b_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "dm_members" (
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" VARCHAR(8) NOT NULL DEFAULT 'member',
    "status" VARCHAR(8) NOT NULL DEFAULT 'active',
    "read_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_members_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateIndex
CREATE INDEX "dm_members_user_id_idx" ON "dm_members"("user_id");

-- AddForeignKey
ALTER TABLE "dm_members" ADD CONSTRAINT "dm_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

