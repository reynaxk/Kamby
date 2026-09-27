-- CreateTable
CREATE TABLE "solana_token_markets" (
    "id" TEXT NOT NULL,
    "mint_address" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "decimals" INTEGER,
    "logo_url" TEXT,
    "quote_mint_address" TEXT NOT NULL,
    "quote_symbol" TEXT,
    "dex" TEXT,
    "price_usd" DECIMAL(38,18),
    "liquidity_usd" DECIMAL(38,18),
    "volume_24h_usd" DECIMAL(38,18),
    "price_change_24h_pct" DECIMAL(12,4),
    "market_cap_usd" DECIMAL(38,2),
    "last_price_update_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solana_token_markets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solana_token_markets_mint_address_key" ON "solana_token_markets"("mint_address");

-- CreateIndex
CREATE INDEX "solana_token_markets_liquidity_usd_idx" ON "solana_token_markets"("liquidity_usd");
