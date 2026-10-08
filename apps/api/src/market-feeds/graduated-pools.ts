import { pickSanePair, SOLANA_STANDARD_QUOTE_MINTS, type TokenStats } from '@kamby/domain';
import { geckoCoolingDown, noteGeckoStatus } from '../market/gecko-ohlcv';

/**
 * A graduated Solana coin's real pools, from GeckoTerminal (2026-10-08). DexScreener can keep
 * listing only a coin's old launch curve after it graduates (see launchPoolOnly in
 * live-price.service.ts) — its chart then drew a dead pool and its stats strip read the curve's
 * numbers. GeckoTerminal lists the PumpSwap / Meteora pools it moved to, with the same stats.
 * Only asked for those coins, cached 30s, and respects the shared GeckoTerminal cooldown.
 */
export interface GeckoPool {
  attributes?: {
    address?: string;
    base_token_price_usd?: string;
    reserve_in_usd?: string;
    fdv_usd?: string | null;
    pool_created_at?: string | null;
    price_change_percentage?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', string>>;
    volume_usd?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', string>>;
    transactions?: Partial<Record<'h1' | 'h24', { buys?: number; sells?: number }>>;
  };
  relationships?: { base_token?: { data?: { id?: string } }; quote_token?: { data?: { id?: string } } };
}

const CACHE_MS = 30_000;
const cache = new Map<string, { pools: GeckoPool[]; at: number }>();

export async function geckoPools(mint: string): Promise<GeckoPool[] | null> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.pools;
  if (geckoCoolingDown()) return hit?.pools ?? null;
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?page=1`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    noteGeckoStatus(res.status);
    if (!res.ok) return hit?.pools ?? null;
    const body = (await res.json()) as { data?: GeckoPool[] };
    const pools = body.data ?? [];
    cache.set(mint, { pools, at: Date.now() });
    return pools;
  } catch {
    return hit?.pools ?? null;
  }
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Pools where the coin is the base token, as pickSanePair candidates. */
function candidates(pools: GeckoPool[], mint: string) {
  return pools
    .filter((p) => p.relationships?.base_token?.data?.id === `solana_${mint}` && p.attributes?.address)
    .map((p) => ({
      pool: p,
      priceUsd: num(p.attributes?.base_token_price_usd),
      liquidityUsd: num(p.attributes?.reserve_in_usd),
      quoteAddress: p.relationships?.quote_token?.data?.id?.replace(/^solana_/, ''),
      pairAddress: p.attributes!.address!,
    }))
    .filter((c) => c.priceUsd > 0);
}

/** Exported for tests. The coin's main pool — deepest sane one, mispriced outliers ignored. */
export function bestGeckoPool(pools: GeckoPool[], mint: string): GeckoPool | null {
  const list = candidates(pools, mint);
  const best = pickSanePair(list, SOLANA_STANDARD_QUOTE_MINTS);
  return best ? (list.find((c) => c.pairAddress === best.pairAddress)?.pool ?? null) : null;
}

/** Exported for tests. TokenStats from GeckoTerminal pools: price changes from the main pool;
 *  volume and trades summed over pools priced within 50% of it with at least $1K liquidity. */
export function statsFromGeckoPools(pools: GeckoPool[], mint: string, atIso: string): TokenStats | null {
  const main = bestGeckoPool(pools, mint);
  if (!main) return null;
  const mainPrice = num(main.attributes?.base_token_price_usd);
  const real = candidates(pools, mint)
    .filter((c) => c.liquidityUsd >= 1_000 && Math.abs(c.priceUsd / mainPrice - 1) <= 0.5)
    .map((c) => c.pool);
  const set = real.length > 0 ? real : [main];
  const sum = (pick: (p: GeckoPool) => unknown) => set.reduce((total, p) => total + num(pick(p)), 0);
  const pct = (v: string | undefined): number | null => (v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const created = set.map((p) => Date.parse(p.attributes?.pool_created_at ?? '')).filter((t) => Number.isFinite(t));
  const fdv = num(main.attributes?.fdv_usd);
  const change = main.attributes?.price_change_percentage ?? {};
  return {
    priceChangePct: { m5: pct(change.m5), h1: pct(change.h1), h6: pct(change.h6), h24: pct(change.h24) },
    volumeUsd: { m5: sum((p) => p.attributes?.volume_usd?.m5), h1: sum((p) => p.attributes?.volume_usd?.h1), h6: sum((p) => p.attributes?.volume_usd?.h6), h24: sum((p) => p.attributes?.volume_usd?.h24) },
    txns24h: { buys: sum((p) => p.attributes?.transactions?.h24?.buys), sells: sum((p) => p.attributes?.transactions?.h24?.sells) },
    txns1h: { buys: sum((p) => p.attributes?.transactions?.h1?.buys), sells: sum((p) => p.attributes?.transactions?.h1?.sells) },
    fdvUsd: fdv > 0 ? fdv : null,
    pairCreatedAtMs: created.length > 0 ? Math.min(...created) : null,
    atIso,
  };
}
