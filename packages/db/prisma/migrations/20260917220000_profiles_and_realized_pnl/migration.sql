-- Note: this migration was generated via a manual `prisma migrate diff` against a local
-- shadow DB (see the environment note in this migration's own directory, if present) —
-- the raw diff also proposed dropping `candles_bucket_start_idx` (TimescaleDB's own
-- create_hypertable() index, not represented in schema.prisma at all — see
-- 20260904130000_market_data's migration.sql) and re-creating
-- `users_referred_by_user_id_fkey` as ON DELETE SET NULL (contradicting that FK's own
-- documented intent — RESTRICT, so a referrer can't be deleted while still credited with
-- referrals — see 20260910213500_referral_program's migration.sql and User.referredBy's
-- doc comment in schema.prisma). Both are pre-existing drift unrelated to this migration's
-- actual purpose and were deliberately excluded here, not applied.

-- AlterTable
ALTER TABLE "solana_trade_transactions" ADD COLUMN     "pnl_processed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "trade_transactions" ADD COLUMN     "pnl_processed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "username" VARCHAR(20);

-- AlterTable
ALTER TABLE "wallets" DROP COLUMN "avatar_url",
DROP COLUMN "display_name";

-- CreateTable
CREATE TABLE "token_lots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chain" "WalletChain" NOT NULL,
    "evm_token_id" TEXT,
    "solana_mint" TEXT,
    "evm_buy_transaction_id" TEXT,
    "solana_buy_transaction_id" TEXT,
    "quantity_original_raw" TEXT NOT NULL,
    "quantity_remaining_raw" TEXT NOT NULL,
    "cost_basis_usd" DECIMAL(38,18) NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "realized_pnl_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chain" "WalletChain" NOT NULL,
    "evm_token_id" TEXT,
    "solana_mint" TEXT,
    "lot_id" TEXT NOT NULL,
    "evm_sell_transaction_id" TEXT,
    "solana_sell_transaction_id" TEXT,
    "quantity_matched_raw" TEXT NOT NULL,
    "cost_basis_usd" DECIMAL(38,18) NOT NULL,
    "proceeds_usd" DECIMAL(38,18) NOT NULL,
    "realized_pnl_usd" DECIMAL(38,18) NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realized_pnl_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "token_lots_evm_buy_transaction_id_key" ON "token_lots"("evm_buy_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "token_lots_solana_buy_transaction_id_key" ON "token_lots"("solana_buy_transaction_id");

-- CreateIndex
CREATE INDEX "token_lots_user_id_chain_evm_token_id_idx" ON "token_lots"("user_id", "chain", "evm_token_id");

-- CreateIndex
CREATE INDEX "token_lots_user_id_chain_solana_mint_idx" ON "token_lots"("user_id", "chain", "solana_mint");

-- CreateIndex
CREATE INDEX "realized_pnl_events_user_id_confirmed_at_idx" ON "realized_pnl_events"("user_id", "confirmed_at");

-- CreateIndex
CREATE UNIQUE INDEX "realized_pnl_events_evm_sell_transaction_id_lot_id_key" ON "realized_pnl_events"("evm_sell_transaction_id", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "realized_pnl_events_solana_sell_transaction_id_lot_id_key" ON "realized_pnl_events"("solana_sell_transaction_id", "lot_id");

-- CreateIndex
CREATE INDEX "solana_trade_transactions_status_pnl_processed_at_idx" ON "solana_trade_transactions"("status", "pnl_processed_at");

-- CreateIndex
CREATE INDEX "trade_transactions_status_pnl_processed_at_idx" ON "trade_transactions"("status", "pnl_processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_evm_token_id_fkey" FOREIGN KEY ("evm_token_id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_evm_buy_transaction_id_fkey" FOREIGN KEY ("evm_buy_transaction_id") REFERENCES "trade_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_solana_buy_transaction_id_fkey" FOREIGN KEY ("solana_buy_transaction_id") REFERENCES "solana_trade_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realized_pnl_events" ADD CONSTRAINT "realized_pnl_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realized_pnl_events" ADD CONSTRAINT "realized_pnl_events_evm_token_id_fkey" FOREIGN KEY ("evm_token_id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realized_pnl_events" ADD CONSTRAINT "realized_pnl_events_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "token_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realized_pnl_events" ADD CONSTRAINT "realized_pnl_events_evm_sell_transaction_id_fkey" FOREIGN KEY ("evm_sell_transaction_id") REFERENCES "trade_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realized_pnl_events" ADD CONSTRAINT "realized_pnl_events_solana_sell_transaction_id_fkey" FOREIGN KEY ("solana_sell_transaction_id") REFERENCES "solana_trade_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

