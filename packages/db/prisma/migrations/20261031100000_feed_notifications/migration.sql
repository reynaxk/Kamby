-- AlterEnum (2026-10-31): Feed likes and replies.
ALTER TYPE "NotificationType" ADD VALUE 'FEED_LIKE';
ALTER TYPE "NotificationType" ADD VALUE 'FEED_REPLY';
