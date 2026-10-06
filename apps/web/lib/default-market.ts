import { isCuratedMarket, slugForIdentifier, type MarketSummary, type TrendingToken } from '@kamby/domain';

function isSafeDefault(market: MarketSummary): boolean {
  // EVM-routable (the terminal's chart/trade flow is EVM-only) and hand-picked. Pool discovery
  // auto-publishes anything clearing a $10K liquidity floor with no wash-trade filtering, so a
  // discovered token can trend on fake volume — the homepage's first impression shouldn't be one.
  return slugForIdentifier(market.chainIdentifier) !== null && isCuratedMarket(market.chainIdentifier, market.tokenAddress);
}

/** A coin worth opening the terminal on: tradeable here (EVM), priced, fresh, and with real
 *  depth and trading — the floor that keeps a fake-volume pool from being a first impression. */
function isHotCandidate(market: MarketSummary, anyChain = false): boolean {
  return (
    (anyChain ? market.chainIdentifier === 'solana' || slugForIdentifier(market.chainIdentifier) !== null : slugForIdentifier(market.chainIdentifier) !== null) &&
    (market.priceUsd ?? 0) > 0 &&
    !market.isStale &&
    (market.liquidityUsd ?? 0) >= 20_000 &&
    (market.volume24hUsd ?? 0) >= 5_000
  );
}

/** How deep into the hot list the random pick reaches. */
const HOT_POOL = 20;
/** How deep into each live list the browser's start-coin pick reaches (owner: "top 30"). */
const START_POOL = 30;
/** A bonding-curve coin needs at least this much SOL raised to be a start coin. */
const MIN_BONDING_SOL_LAMPORTS = 10n * 1_000_000_000n;

export type StartCoin = { kind: 'evm'; market: MarketSummary } | { kind: 'solana'; mint: string };

/** The terminal's start coin on each visit (owner request 2026-10-06): random from the top 30 of
 *  live Trending (any chain, isHotCandidate floor) plus the top 30 of Bonding (10+ SOL raised).
 *  A Solana coin opens on its own coin page; a Base/BNB coin in the terminal. `random` for tests. */
export function pickStartCoin(
  trending: readonly MarketSummary[],
  bonding: readonly { mintAddress: string; realSolReserves: string; complete: boolean }[],
  random: () => number = Math.random,
): StartCoin | undefined {
  const pool: StartCoin[] = [
    ...trending.slice(0, START_POOL).filter((m) => isHotCandidate(m, true)).map((m): StartCoin =>
      m.chainIdentifier === 'solana' ? { kind: 'solana', mint: m.tokenAddress } : { kind: 'evm', market: m },
    ),
    ...bonding
      .slice(0, START_POOL)
      .filter((t) => !t.complete && /^\d+$/.test(t.realSolReserves) && BigInt(t.realSolReserves) >= MIN_BONDING_SOL_LAMPORTS)
      .map((t): StartCoin => ({ kind: 'solana', mint: t.mintAddress })),
  ];
  return pool.length > 0 ? pool[Math.floor(random() * pool.length)] : undefined;
}

/** The Discover terminal's default selection (2026-10-06: "it's always some big famous coin or
 *  the same one" — the pick was limited to the ~40 hand-picked markets, and the page is cached
 *  15s). A random coin from the top of the live Trending list (majors already excluded there)
 *  that clears isHotCandidate; else a random curated trending market; else the top-ranked
 *  curated one; else anything selectable. Called again in the browser on each visit, so the
 *  page cache never repeats it. `random` is injectable for tests. */
export function pickDefaultMarket(
  ranked: MarketSummary[],
  trending: TrendingToken[],
  random: () => number = Math.random,
): MarketSummary | undefined {
  const hot = ranked.filter((m) => isHotCandidate(m)).slice(0, HOT_POOL);
  if (hot.length > 0) return hot[Math.floor(random() * hot.length)];
  const candidates = trending.map((t) => t.market).filter(isSafeDefault);
  if (candidates.length > 0) return candidates[Math.floor(random() * candidates.length)];
  return ranked.find(isSafeDefault) ?? ranked.find((m) => slugForIdentifier(m.chainIdentifier) !== null);
}
