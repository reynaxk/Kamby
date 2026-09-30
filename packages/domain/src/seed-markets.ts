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
  {
    // CLANKER/WETH — added 2026-09-24. $1.58M liquidity; token0/token1/slot0 verified
    // directly against this pool contract on Base's public RPC (token0 = CLANKER, token1 =
    // WETH, initialized). Clanker is Base's own token-deployment-bot protocol.
    poolAddress: '0xC1a6FBeDAe68E1472DbB91FE29B51F7a0Bd44F97',
    baseTokenAddress: '0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb',
    dex: 'uniswap-v3',
  },
  {
    // BNKR/WETH — added 2026-09-24. $2.94M liquidity, deepest new entry this batch;
    // token0/token1/slot0 verified directly against this pool contract on Base's public RPC
    // (token0 = BNKR, token1 = WETH, initialized).
    poolAddress: '0xAEC085E5A5CE8d96A7bDd3eB3A62445d4f6CE703',
    baseTokenAddress: '0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b',
    dex: 'uniswap-v3',
  },
  {
    // MORPHO/USDC — added 2026-09-24. $387K liquidity; token0/token1/slot0 verified directly
    // against this pool contract on Base's public RPC (token0 = USDC, token1 = MORPHO,
    // initialized). Quoted in USDC, no ordering dependency.
    poolAddress: '0x2043B296fFC6b2d3bf4A3F3167d2Afb3B0FBdbEE',
    baseTokenAddress: '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842',
    dex: 'uniswap-v3',
  },
  {
    // AAVE/WETH — added 2026-09-24. $280K liquidity; token0/token1/slot0 verified directly
    // against this pool contract on Base's public RPC (token0 = WETH, token1 = AAVE,
    // initialized).
    poolAddress: '0x2e86514CFd61Fb19c5cf2b879d536D273d6E693d',
    baseTokenAddress: '0x63706e401c06ac8513145b7687A14804d17f814b',
    dex: 'uniswap-v3',
  },
  {
    // SPX6900/USDC — added 2026-09-24. $104K liquidity, the thinnest new entry this batch but
    // still real and above the $100K floor; token0/token1/slot0 verified directly against
    // this pool contract on Base's public RPC (token0 = SPX6900, token1 = USDC, initialized).
    poolAddress: '0x037818B04ac34eA8b54b6683b79eF24d23C0E7Cb',
    baseTokenAddress: '0x50dA645f148798F68EF2d7dB7C1CB22A6819bb2C',
    dex: 'uniswap-v3',
  },
  {
    // ZORA/USDC — added 2026-09-24. $91K liquidity, slightly under the usual floor but kept
    // for Zora's real ecosystem prominence (Base-native onchain social/creator protocol);
    // token0/token1/slot0 verified directly against this pool contract on Base's public RPC
    // (token0 = ZORA, token1 = USDC, initialized).
    poolAddress: '0xEdc625B74537eE3a10874f53D170E9c17A906B9c',
    baseTokenAddress: '0x1111111111166b7FE7bd91427724B487980aFc69',
    dex: 'uniswap-v3',
  },  {
    // AERO/WETH — added 2026-09-30. $1.44M liquidity. Aerodrome's own token; its deepest pools are on Aerodrome (unreadable here), but this Uniswap V3 pool is independently deep. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official Uniswap V3 factory on Base, initialized).
    poolAddress: '0x3d5D143381916280ff91407FeBEB52f2b60f33Cf',
    baseTokenAddress: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    dex: 'uniswap-v3',
  },
  {
    // VVV/USDC — added 2026-09-30. $682K liquidity (Venice). Quoted in USDC, no ordering dependency. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official Uniswap V3 factory on Base, initialized).
    poolAddress: '0x67A11022B7B6ed66f81233F6C8Ed6e48F7826530',
    baseTokenAddress: '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf',
    dex: 'uniswap-v3',
  },
  {
    // UNI/WETH — added 2026-09-30. $356K liquidity (Uniswap, bridged). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official Uniswap V3 factory on Base, initialized).
    poolAddress: '0xAb365f161Dd501473a1ff0D2ef0dCE94E7398839',
    baseTokenAddress: '0xc3De830EA07524a0761646a6a4e4be0e114a3C83',
    dex: 'uniswap-v3',
  },
  {
    // AIXBT/USDC — added 2026-09-30. $346K liquidity. Quoted in USDC, no ordering dependency. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official Uniswap V3 factory on Base, initialized).
    poolAddress: '0xf1Fdc83c3A336bdbDC9fB06e318B08EadDC82FF4',
    baseTokenAddress: '0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825',
    dex: 'uniswap-v3',
  },
  {
    // DRB/WETH — added 2026-09-30. $1.59M liquidity (DebtReliefBot). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official Uniswap V3 factory on Base, initialized).
    poolAddress: '0x5116773e18A9C7bB03EBB961b38678E45E238923',
    baseTokenAddress: '0x3ec2156D4c0A9CBdAB4a016633b7BcF6a8d68Ea2',
    dex: 'uniswap-v3',
  },
  {
    // DOGINME/WETH — added 2026-09-30. $1.33M liquidity. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official Uniswap V3 factory on Base, initialized).
    poolAddress: '0xADE9BcD4b968EE26Bed102dd43A55f6A8c2416df',
    baseTokenAddress: '0x6921B130D297cc43754afba22e5EAc0FBf8Db75b',
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
  {
    // CAKE/USDT — added 2026-09-24. $6.34M liquidity, the deepest entry in this file;
    // token0/token1/slot0 verified directly against this pool contract on BNB Chain's public
    // RPC (token0 = CAKE, token1 = USDT, initialized). Quoted in USDT, not WBNB/USDC, so this
    // must stay ordered after the USDT/WBNB market above (USDT's own price must already be
    // resolved).
    poolAddress: '0x7f51c8AaA6B0599aBd16674e2b17FEc7a9f674A1',
    baseTokenAddress: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    dex: 'pancakeswap-v3',
  },
  {
    // TWT/WBNB — added 2026-09-24. $605K liquidity; token0/token1/slot0 verified directly
    // against this pool contract on BNB Chain's public RPC (token0 = TWT, token1 = WBNB,
    // initialized).
    poolAddress: '0x8cCB4544b3030dACF3d4D71C658f04e8688e25b1',
    baseTokenAddress: '0x4B0F1812e5Df2A09796481Ff14017e6005508003',
    dex: 'pancakeswap-v3',
  },
  {
    // XVS/WBNB — added 2026-09-24. $240K liquidity; token0/token1/slot0 verified directly
    // against this pool contract on BNB Chain's public RPC (token0 = WBNB, token1 = XVS,
    // initialized). Venus Protocol's governance token, BNB Chain-native.
    poolAddress: '0x77d5b2560e4B84b3fC58875Cb0133F39560e8AE3',
    baseTokenAddress: '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63',
    dex: 'pancakeswap-v3',
  },
  {
    // BabyDoge/WBNB — added 2026-09-24 (2nd batch). $7.1M liquidity, deepest entry in this
    // file besides CAKE; token0/token1/slot0 verified directly against this pool contract on
    // BNB Chain's public RPC (token0 = WBNB, token1 = BabyDoge, initialized).
    poolAddress: '0x61db764C20a2EBfB7e8a7a5AFb0b2Dd85A4CEF5f',
    baseTokenAddress: '0xc748673057861a797275CD8A068AbB95A902e8de',
    dex: 'pancakeswap-v3',
  },
  {
    // SFP/WBNB (SafePal) — added 2026-09-24 (2nd batch). $852K liquidity; token0/token1/slot0
    // verified directly against this pool contract on BNB Chain's public RPC (token0 = WBNB,
    // token1 = SFP, initialized).
    poolAddress: '0x64ebB904e169cB94e9788FcB68283B4C894ED881',
    baseTokenAddress: '0xD41FDb03Ba84762dD66a0af1a6C8540FF1ba5dfb',
    dex: 'pancakeswap-v3',
  },  {
    // BTCB/WBNB — added 2026-09-30. $28.4M liquidity (Binance-Peg BTC). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0x6bbc40579ad1BBD243895cA0ACB086BB6300d636',
    baseTokenAddress: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
    dex: 'pancakeswap-v3',
  },
  {
    // ETH/WBNB — added 2026-09-30. $17.1M liquidity (Binance-Peg ETH). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0xD0e226f674bBf064f54aB47F42473fF80DB98CBA',
    baseTokenAddress: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    dex: 'pancakeswap-v3',
  },
  {
    // ASTER/WBNB — added 2026-09-30. $1.18M liquidity. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0xb040ea24a4Ef35a3ED400B0fF26D8B6F30DEEcaD',
    baseTokenAddress: '0x000Ae314E2A2172a039B26378814C252734f556A',
    dex: 'pancakeswap-v3',
  },
  {
    // DOGE/WBNB — added 2026-09-30. $656K liquidity (Binance-Peg DOGE). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0xce6160bB594fC055c943F59De92ceE30b8c6B32c',
    baseTokenAddress: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43',
    dex: 'pancakeswap-v3',
  },
  {
    // MUBARAK/WBNB — added 2026-09-30. $2.95M liquidity. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0x90A54475D512B8f3852351611c38faD30a513491',
    baseTokenAddress: '0x5C85D6C6825aB4032337F11Ee92a72DF936b46F6',
    dex: 'pancakeswap-v3',
  },
  {
    // BROCCOLI/WBNB — added 2026-09-30. $2.49M liquidity ("CZ'S DOG"). Several BROCCOLI tokens exist; this is the deepest, and the only one listed. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0xA5067360b13Fc7A2685Dc82dcD1bF2B4B8D7868B',
    baseTokenAddress: '0x6d5AD1592ed9D6D1dF9b93c793AB759573Ed6714',
    dex: 'pancakeswap-v3',
  },
  {
    // B2/WBNB — added 2026-09-30. $851K liquidity (BSquared). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0xc1A780989734a0e5df875cEbe410748562e1c5e6',
    baseTokenAddress: '0x783c3f003f172c6Ac5AC700218a357d2D66Ee2a2',
    dex: 'pancakeswap-v3',
  },
  {
    // BANK/WBNB — added 2026-09-30. $587K liquidity (Lorenzo). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0xee6fF918A1f68B5d2FDEcb14b367FA2EB5C6951c',
    baseTokenAddress: '0x3AeE7602b612de36088F3ffEd8c8f10E86EbF2bF',
    dex: 'pancakeswap-v3',
  },
  {
    // MYX/WBNB — added 2026-09-30. $258K liquidity. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0x6eC31Af1Bb9a72aaCEc12E4dED508861b05F4503',
    baseTokenAddress: '0xD82544bf0dfe8385eF8FA34D67e6e4940CC63e16',
    dex: 'pancakeswap-v3',
  },
  {
    // UNI/WBNB — added 2026-09-30. $182K liquidity (Binance-Peg UNI). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0x647D99772863e09f47435782cbb6C96eC4A75f12',
    baseTokenAddress: '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1',
    dex: 'pancakeswap-v3',
  },
  {
    // DOT/WBNB — added 2026-09-30. $177K liquidity (Binance-Peg DOT). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0x62F0546cBcd684F7C394D8549119e072527C41Bc',
    baseTokenAddress: '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402',
    dex: 'pancakeswap-v3',
  },
  {
    // AVAX/WBNB — added 2026-09-30. $136K liquidity (Binance-Peg AVAX). token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0x1D8B1eD9b3da5d510FD3723e0Dd02476E0d7e781',
    baseTokenAddress: '0x1CE0c2827e2eF14D5C4f29a091d735A204794041',
    dex: 'pancakeswap-v3',
  },
  {
    // XPL/USDT — added 2026-09-30. $420K liquidity (Plasma). USDT-quoted, so it must stay after the USDT/WBNB entry above. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0x50203DF8eFcddBa9755C886F086b9B2D537a15F9',
    baseTokenAddress: '0x405FBc9004D857903bFD6b3357792D71a50726b0',
    dex: 'pancakeswap-v3',
  },
  {
    // FORM/USDT — added 2026-09-30. $620K liquidity (Four). USDT-quoted, so it must stay after the USDT/WBNB entry above. token0/token1/factory/slot0 verified directly against this pool contract (factory is the official PancakeSwap V3 factory on BNB Chain, initialized).
    poolAddress: '0x7Cb113B487e025b3a69537fcA579559433240cb5',
    baseTokenAddress: '0x5b73A93b4E5e4f1FD27D8b3F8C97D69908b5E284',
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

const CURATED_MARKET_KEYS: ReadonlySet<string> = new Set(
  Object.entries(SEED_MARKETS_BY_CHAIN_IDENTIFIER).flatMap(([chainIdentifier, { seedMarkets }]) =>
    seedMarkets.map((m) => `${chainIdentifier}:${m.baseTokenAddress.toLowerCase()}`),
  ),
);

/** Whether a market is on the hand-picked seed list above, as opposed to one automated pool
 *  discovery promoted. `TokenMarket` rows deliberately don't record which path created them,
 *  so this list is the only record. Matches on the base token, not the pool — a curated token
 *  is trusted regardless of which pool is serving its price. */
export function isCuratedMarket(chainIdentifier: string, tokenAddress: string): boolean {
  return CURATED_MARKET_KEYS.has(`${chainIdentifier}:${tokenAddress.toLowerCase()}`);
}
