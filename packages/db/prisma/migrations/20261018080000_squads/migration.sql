-- AlterTable
ALTER TABLE "dm_conversations" ADD COLUMN     "about" VARCHAR(140),
ADD COLUMN     "visibility" VARCHAR(8) NOT NULL DEFAULT 'private';

