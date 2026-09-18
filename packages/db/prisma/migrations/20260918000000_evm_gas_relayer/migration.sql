-- CreateEnum
CREATE TYPE "EvmRelayerQuoteStatus" AS ENUM ('PENDING_CONSENT', 'CONSENT_RECEIVED', 'BROADCAST', 'FAILED');

-- AlterTable
ALTER TABLE "trade_quotes" ADD COLUMN     "sponsorship_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "relayer_consent_signature" TEXT,
ADD COLUMN     "relayer_status" "EvmRelayerQuoteStatus",
ADD COLUMN     "relayer_nonce" INTEGER,
ADD COLUMN     "relayer_failure_reason" TEXT;

-- AlterTable
ALTER TABLE "trade_transactions" ADD COLUMN     "sponsored_by_relayer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "relayer_fee_payer" TEXT;
