-- Solana trading, launch scope (non-custodial — see docs/WALLET_SECURITY.md's Solana
-- section). Purely additive: every new/altered column here is nullable or has a safe
-- default, so this applies cleanly on top of live data. `wallets.chain` defaults to 'EVM'
-- since every wallet before this column existed was, in fact, EVM.

-- CreateEnum
CREATE TYPE "WalletChain" AS ENUM ('EVM', 'SOLANA');

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN "chain" "WalletChain" NOT NULL DEFAULT 'EVM';

-- CreateIndex
CREATE UNIQUE INDEX "wallets_chain_address_key" ON "wallets"("chain", "address");

-- CreateTable
CREATE TABLE "solana_wallet_challenges" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solana_wallet_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solana_trade_quotes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "input_mint" TEXT NOT NULL,
    "output_mint" TEXT NOT NULL,
    "input_amount" TEXT NOT NULL,
    "expected_output_amount" TEXT NOT NULL,
    "min_output_amount" TEXT NOT NULL,
    "price_usd" DECIMAL(38,18),
    "price_impact_bps" INTEGER,
    "slippage_bps" INTEGER NOT NULL,
    "platform_fee_bps" INTEGER NOT NULL,
    "platform_fee_amount" TEXT NOT NULL,
    "provider_quote_id" TEXT,
    "unsigned_tx" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solana_trade_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solana_trade_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "input_mint" TEXT NOT NULL,
    "output_mint" TEXT NOT NULL,
    "input_amount" TEXT NOT NULL,
    "expected_output_amount" TEXT NOT NULL,
    "platform_fee_amount" TEXT NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solana_trade_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solana_wallet_challenges_nonce_key" ON "solana_wallet_challenges"("nonce");

-- CreateIndex
CREATE INDEX "solana_wallet_challenges_address_idx" ON "solana_wallet_challenges"("address");

-- CreateIndex
CREATE INDEX "solana_wallet_challenges_expires_at_idx" ON "solana_wallet_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "solana_trade_quotes_user_id_created_at_idx" ON "solana_trade_quotes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "solana_trade_quotes_expires_at_idx" ON "solana_trade_quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "solana_trade_transactions_quote_id_key" ON "solana_trade_transactions"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "solana_trade_transactions_signature_key" ON "solana_trade_transactions"("signature");

-- CreateIndex
CREATE INDEX "solana_trade_transactions_user_id_created_at_idx" ON "solana_trade_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "solana_trade_transactions_status_idx" ON "solana_trade_transactions"("status");

-- AddForeignKey
ALTER TABLE "solana_wallet_challenges" ADD CONSTRAINT "solana_wallet_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solana_trade_quotes" ADD CONSTRAINT "solana_trade_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solana_trade_quotes" ADD CONSTRAINT "solana_trade_quotes_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "wallets"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solana_trade_transactions" ADD CONSTRAINT "solana_trade_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solana_trade_transactions" ADD CONSTRAINT "solana_trade_transactions_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "wallets"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solana_trade_transactions" ADD CONSTRAINT "solana_trade_transactions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "solana_trade_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
