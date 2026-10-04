import { EVM_USDC_BY_CHAIN_ID } from '@kamby/domain';

/**
 * Each EVM chain's USDC — what every Kamby trade pays with and sells into (product decision
 * 2026-10-02: users only ever hold USDC). Must match the API's CHAIN_<SLUG>_USDC_ADDRESS;
 * decimals are fixed by each token contract (BNB Chain's USDC uses 18, not 6).
 */
export const USDC_BY_CHAIN_ID = EVM_USDC_BY_CHAIN_ID;
