-- CreateIndex
CREATE INDEX "trade_transactions_token_market_id_confirmed_at_idx" ON "trade_transactions"("token_market_id", "confirmed_at");

-- CreateIndex
CREATE INDEX "solana_trade_transactions_output_mint_confirmed_at_idx" ON "solana_trade_transactions"("output_mint", "confirmed_at");

-- CreateIndex
CREATE INDEX "solana_trade_transactions_input_mint_confirmed_at_idx" ON "solana_trade_transactions"("input_mint", "confirmed_at");
