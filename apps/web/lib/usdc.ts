/**
 * Each EVM chain's USDC — what every Kamby trade pays with and sells into (product decision
 * 2026-10-02: users only ever hold USDC). Must match the API's CHAIN_<SLUG>_USDC_ADDRESS;
 * decimals are fixed by each token contract (BNB Chain's USDC uses 18, not 6).
 */
export const USDC_BY_CHAIN_ID: Record<number, { address: string; symbol: 'USDC'; decimals: number }> = {
  8453: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
  56: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 },
};
