/**
 * Phase 1's bounded, curated set of markets to track — see docs/MARKET_DATA.md#token-discovery
 * for why a curated seed list rather than scanning every pool a factory has ever created.
 * One list per chain, keyed by that chain's real CAIP-2 identifier via
 * `SEED_MARKETS_BY_CHAIN_IDENTIFIER` below — `apps/workers` runs one chain per deployed
 * instance (see its own `.env.example`), so `main.ts` picks exactly one of these lists at
 * startup from `env.CHAIN_IDENTIFIER`, never all of them.
 *
 * Deliberately minimal: only addresses. Every pool below was read directly on-chain
 * (token0/token1/slot0, fee, liquidity, all initialized) via that chain's own public RPC
 * during development, and cross-checked for real liquidity via DexScreener/GeckoTerminal or
 * the DEX's own factory contract — but those sources were used only to *find* candidate
 * pools, never as a source for price, liquidity, or token metadata. All of that — symbol,
 * name, decimals — is resolved live from the contracts themselves by the ingestion worker,
 * never hardcoded here, so there is nothing in this file that could be a stale or wrong
 * "fact" about a token.
 *
 * Order matters within each chain's list: a market's quote token must already have a
 * resolved USD price by the time its own market is processed (see `resolveUsdPrice` in
 * ingestion.ts, seeded with that chain's own `CHAIN_QUOTE_USDC_ADDRESS` env var as the one
 * pegged-to-$1 reference). USDC-quoted markets can go in any order; a market quoted in the
 * chain's own wrapped-native token (WETH on Base, WBNB on BNB Chain) must come after that
 * chain's own native/USDC market.
 */

/** Base (eip155:8453) — treated as pegged 1:1 to USD, a Phase 1 simplification, not a
 *  depeg-aware oracle. Must match `apps/workers/.env.example`'s `CHAIN_QUOTE_USDC_ADDRESS`
 *  for a Base deployment. */
export const USDC_ADDRESS_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** BNB Chain (eip155:56) — the real Binance-Peg USDC address, confirmed via BscScan
 *  2026-09-15/16 (same value already used in apps/api's own `CHAIN_BNB_USDC_ADDRESS`).
 *  Same "pegged 1:1" simplification as USDC_ADDRESS_BASE above. */
export const USDC_ADDRESS_BNB = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';

export interface SeedMarket {
  /** The pool contract to read price/liquidity/swaps from. */
  poolAddress: string;
  /** Which of the pool's two tokens is the one being tracked ("discovered"); the other
   *  is this market's quote token. */
  baseTokenAddress: string;
  /** Purely a display/analytics string (`MarketSummary.dex`, `z.string().nullable()` — see
   *  packages/domain/src/market.ts) — the actual on-chain reading always goes through the
   *  same `UniswapV3PoolReader` regardless of this value, since every DEX below is a
   *  verified Uniswap-V3-ABI-compatible fork (confirmed live on-chain for PancakeSwap V3,
   *  2026-09-16: slot0()/token0()/token1()/fee()/liquidity() all decode correctly against
   *  real BNB Chain pools). Kept distinct from 'uniswap-v3' anyway so a BNB Chain token
   *  never shows a factually wrong DEX name to a user. */
  dex: 'uniswap-v3' | 'pancakeswap-v3';
}

export const BASE_SEED_MARKETS: SeedMarket[] = [
  {
    // WETH/USDC — resolves WETH's USD price, which DEGEN and BRETT below depend on.
    poolAddress: '0x6c561B446416E1A00E8E93E221854d6eA4171372',
    baseTokenAddress: '0x4200000000000000000000000000000000000006',
    dex: 'uniswap-v3',
  },
  {
    // cbBTC/USDC
    poolAddress: '0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef',
    baseTokenAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    dex: 'uniswap-v3',
  },
  {
    // DEGEN/WETH
    poolAddress: '0x0cA6485b7e9cF814A3Fd09d81672B07323535b64',
    baseTokenAddress: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
    dex: 'uniswap-v3',
  },
  {
    // BRETT/WETH
    poolAddress: '0xBA3F945812a83471d709BCe9C3CA699A19FB46f7',
    baseTokenAddress: '0x532f27101965dd16442E59d40670FaF5eBB142E4',
    dex: 'uniswap-v3',
  },
  {
    // TOSHI/WETH — added 2026-09-24. $1.2M liquidity verified live via DexScreener at
    // discovery time; token0/token1/slot0 confirmed directly against this pool contract on
    // Base's public RPC (token0 = WETH, token1 = TOSHI, sqrtPriceX96 non-zero/initialized).
    // Real Uniswap V3 liquidity is thin relative to TOSHI's actual trading volume (most of it
    // is on Aerodrome and Uniswap V4, which this reader can't consume), but this specific
    // pool clears the same bar as DEGEN/BRETT above.
    poolAddress: '0x4b0Aaf3EBb163dd45F663b38b6d93f6093EBC2d3',
    baseTokenAddress: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4',
    dex: 'uniswap-v3',
  },
  {
    // VIRTUAL/USDC — added 2026-09-24. $1.07M liquidity verified live via DexScreener at
    // discovery time; token0/token1/slot0 confirmed directly against this pool contract on
    // Base's public RPC (token0 = VIRTUAL, token1 = USDC, sqrtPriceX96 non-zero/initialized).
    // Quoted directly in USDC, so no ordering dependency on the WETH/USDC entry above.
    poolAddress: '0x529d2863a1521d0b57db028168fdE2E97120017C',
    baseTokenAddress: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
    dex: 'uniswap-v3',
  },
];

/**
 * BNB Chain (eip155:56) — added 2026-09-16, real BNB Chain going live. Only 2 entries on
 * purpose (same "curated, bounded, expand once real usage validates it" philosophy as
 * Base's own 4-entry list, not an attempt at initial parity) — both pools verified live via
 * PancakeSwap V3's own factory contract (`getPool(tokenA, tokenB, fee)` at
 * `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`, not a block explorer/aggregator search
 * result taken on faith) and their `liquidity()` read directly before being trusted.
 */
export const BNB_SEED_MARKETS: SeedMarket[] = [
  {
    // WBNB/USDC, 0.01% fee tier — by far the deepest of the 4 fee tiers checked
    // (553,552,718,654,223,820,322,297 raw liquidity vs. the next tier's ~21.4e21 and two
    // near-empty tiers below that). Resolves WBNB's USD price, which the USDT market below
    // depends on.
    poolAddress: '0xf2688Fb5B81049DFB7703aDa5e770543770612C4',
    baseTokenAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    dex: 'pancakeswap-v3',
  },
  {
    // USDT/WBNB, 0.05% fee tier — tracks Binance-Peg USDT itself (baseTokenAddress), quoted
    // in WBNB rather than USDC, so this must stay ordered after the WBNB/USDC market above.
    poolAddress: '0x36696169c63e42cd08ce11f5deebbcebae652050',
    baseTokenAddress: '0x55d398326f99059fF775485246999027B3197955',
    dex: 'pancakeswap-v3',
  },
];

/** Which seed list + pegged-USDC address a deployment uses, keyed by its own
 *  `env.CHAIN_IDENTIFIER` — see MarketIngestionConfig in ingestion.ts, which is what
 *  actually consumes this (main.ts looks the entry up once at startup, never both at once,
 *  matching apps/workers' one-chain-per-deployment architecture). */
export const SEED_MARKETS_BY_CHAIN_IDENTIFIER: Record<string, { seedMarkets: SeedMarket[]; quoteUsdcAddress: string }> = {
  'eip155:8453': { seedMarkets: BASE_SEED_MARKETS, quoteUsdcAddress: USDC_ADDRESS_BASE },
  'eip155:56': { seedMarkets: BNB_SEED_MARKETS, quoteUsdcAddress: USDC_ADDRESS_BNB },
};
