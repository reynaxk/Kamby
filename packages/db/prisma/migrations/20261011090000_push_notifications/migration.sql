-- Push notifications + more notification types (2026-10-11).
--
-- Additive only: three enum values, two nullable columns and an index on notifications,
-- three defaulted booleans on notification_preferences, and one new table. Nothing is
-- dropped or rewritten, so the running api/workers keep working before they redeploy.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TRADE_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'TRADE_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'PRICE_MOVE';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "payload" JSONB,
ADD COLUMN "pushed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN "trade_updates" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "price_moves" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "push_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_pushed_at_created_at_idx" ON "notifications"("pushed_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
