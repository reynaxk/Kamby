-- Achievements & titles (2026-11-01).
ALTER TYPE "NotificationType" ADD VALUE 'ACHIEVEMENT_UNLOCKED';

ALTER TABLE "users" ADD COLUMN "equipped_title_id" TEXT,
ADD COLUMN "showcase_title_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "user_achievements" (
    "user_id" TEXT NOT NULL,
    "achievement_id" TEXT NOT NULL,
    "current_progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target_value" DOUBLE PRECISION NOT NULL,
    "is_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "unlocked_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("user_id","achievement_id")
);

CREATE INDEX "user_achievements_achievement_id_is_unlocked_idx" ON "user_achievements"("achievement_id", "is_unlocked");

ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
