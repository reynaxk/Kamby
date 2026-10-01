/**
 * Free public EVM endpoints, per numeric chain id, for market data only (pool state, swap
 * logs, pool discovery) — so paid RPC (QuickNode) is reserved for trade execution, balance
 * lookups and broadcasting. Each one was checked on 2026-09-30 to answer `eth_getLogs`
 * over a 150-block range for a single pool address, which is exactly what swap ingestion
 * asks for (see MAX_BLOCKS_PER_TICK in apps/workers/src/market/ingestion.ts). Many other
 * well-known public endpoints were rejected by that same check (a 10- or 50-block
 * `eth_getLogs` cap, "limit exceeded", or getLogs disabled outright) — re-run it before
 * adding one here.
 *
 * Used as an ordered viem `fallback()` list (see createEvmTransport), so a rate-limited or
 * down endpoint just moves the request to the next one.
 */
export const PUBLIC_EVM_RPC_URLS: Readonly<Record<number, readonly string[]>> = {
  8453: [
    'https://base-rpc.publicnode.com',
    'https://mainnet.base.org',
    'https://developer-access-mainnet.base.org',
    'https://base.gateway.tenderly.co',
  ],
  56: [
    'https://bsc-rpc.publicnode.com',
    // bsc.rpc.blxrbdn.com removed 2026-10-01: answers eth_blockNumber but times out (15s+) on
    // every eth_getLogs, stalling each ingestion call that fell back to it.
    'https://rpc-bsc.48.club',
    'https://0.48.club',
  ],
};
