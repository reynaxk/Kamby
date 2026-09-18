-- AlterTable
ALTER TABLE "solana_trade_transactions" ADD COLUMN     "sponsored_by_relayer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "relayer_fee_payer" TEXT;
