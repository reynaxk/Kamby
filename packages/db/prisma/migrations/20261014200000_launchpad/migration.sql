-- CreateTable
CREATE TABLE "token_launches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "launchpad" VARCHAR(16) NOT NULL,
    "chain_identifier" VARCHAR(24) NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "symbol" VARCHAR(10) NOT NULL,
    "description" VARCHAR(500),
    "website" VARCHAR(200),
    "twitter" VARCHAR(200),
    "telegram" VARCHAR(200),
    "image_id" TEXT,
    "metadata_uri" TEXT,
    "dev_buy_usd" DECIMAL(18,6) NOT NULL,
    "fee_usd" DECIMAL(18,6) NOT NULL,
    "network_cost_usd" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "fund_usdc_raw" TEXT,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PREPARED',
    "fund_tx" TEXT,
    "fund_signature" TEXT,
    "create_tx" TEXT,
    "create_signature" TEXT,
    "token_address" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "live_at" TIMESTAMP(3),

    CONSTRAINT "token_launches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launch_assets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "launch_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "token_launches_fund_signature_key" ON "token_launches"("fund_signature");

-- CreateIndex
CREATE UNIQUE INDEX "token_launches_create_signature_key" ON "token_launches"("create_signature");

-- CreateIndex
CREATE INDEX "token_launches_user_id_created_at_idx" ON "token_launches"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "token_launches_token_address_idx" ON "token_launches"("token_address");

-- CreateIndex
CREATE INDEX "launch_assets_user_id_created_at_idx" ON "launch_assets"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "token_launches" ADD CONSTRAINT "token_launches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_launches" ADD CONSTRAINT "token_launches_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "launch_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_assets" ADD CONSTRAINT "launch_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
