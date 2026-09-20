-- CreateTable
CREATE TABLE "token_theses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chain" "WalletChain" NOT NULL,
    "evm_token_id" TEXT,
    "solana_mint" TEXT,
    "text" VARCHAR(280) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_theses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "token_theses_chain_evm_token_id_idx" ON "token_theses"("chain", "evm_token_id");

-- CreateIndex
CREATE INDEX "token_theses_chain_solana_mint_idx" ON "token_theses"("chain", "solana_mint");

-- CreateIndex
CREATE UNIQUE INDEX "token_theses_user_id_chain_evm_token_id_key" ON "token_theses"("user_id", "chain", "evm_token_id");

-- CreateIndex
CREATE UNIQUE INDEX "token_theses_user_id_chain_solana_mint_key" ON "token_theses"("user_id", "chain", "solana_mint");

-- AddForeignKey
ALTER TABLE "token_theses" ADD CONSTRAINT "token_theses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_theses" ADD CONSTRAINT "token_theses_evm_token_id_fkey" FOREIGN KEY ("evm_token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
