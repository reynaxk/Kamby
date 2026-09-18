-- Pump.fun trenches (FRESH/NEAR_GRADUATED/JUST_GRADUATED) — see
-- docs/TRADING.md#pump-fun-trenches. Purely additive: a new table, nothing altered on any
-- existing one.

-- CreateTable
CREATE TABLE "pump_fun_tokens" (
    "id" TEXT NOT NULL,
    "mint_address" TEXT NOT NULL,
    "bonding_curve_address" TEXT NOT NULL,
    "creator_address" TEXT,
    "name" TEXT,
    "symbol" TEXT,
    "uri" TEXT,
    "virtual_token_reserves" TEXT NOT NULL,
    "virtual_sol_reserves" TEXT NOT NULL,
    "real_token_reserves" TEXT NOT NULL,
    "real_sol_reserves" TEXT NOT NULL,
    "token_total_supply" TEXT NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_state_update_at" TIMESTAMP(3) NOT NULL,
    "graduated_at" TIMESTAMP(3),

    CONSTRAINT "pump_fun_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pump_fun_tokens_mint_address_key" ON "pump_fun_tokens"("mint_address");

-- CreateIndex
CREATE UNIQUE INDEX "pump_fun_tokens_bonding_curve_address_key" ON "pump_fun_tokens"("bonding_curve_address");

-- CreateIndex
CREATE INDEX "pump_fun_tokens_complete_created_at_idx" ON "pump_fun_tokens"("complete", "created_at");

-- CreateIndex
CREATE INDEX "pump_fun_tokens_graduated_at_idx" ON "pump_fun_tokens"("graduated_at");
