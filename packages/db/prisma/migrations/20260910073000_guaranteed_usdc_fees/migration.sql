-- Guaranteed-USDC-fees: a second, separate USDC transfer alongside the swap for trades
-- whose cash side is already USDC. See docs/TRADING.md#guaranteed-usdc-fees.
--
-- All new columns are nullable/optional — every existing row (and every trade on a
-- non-USDC-quoted market) simply never has a fee_unsigned_tx / fee_tx_hash, and keeps
-- working exactly as before via the aggregator's own embedded fee.

-- AlterTable
ALTER TABLE "trade_quotes" ADD COLUMN     "fee_unsigned_tx" JSONB;

-- AlterTable
ALTER TABLE "trade_transactions" ADD COLUMN     "fee_tx_hash" TEXT,
ADD COLUMN     "fee_status" "TradeStatus",
ADD COLUMN     "fee_failure_reason" TEXT,
ADD COLUMN     "fee_submitted_at" TIMESTAMP(3),
ADD COLUMN     "fee_confirmed_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "trade_transactions_chain_id_fee_tx_hash_key" ON "trade_transactions"("chain_id", "fee_tx_hash");

-- CreateIndex
CREATE INDEX "trade_transactions_fee_status_idx" ON "trade_transactions"("fee_status");
