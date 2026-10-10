'use client';

import type { Candle, Timeframe } from '@kamby/domain';

/**
 * Candles straight from GeckoTerminal in the viewer's browser (2026-10-04). The API fetches
 * them server-side and caches them for everyone, but GeckoTerminal's free tier allows ~30
 * calls a minute per IP — and every Kamby viewer shares the API's one IP, so under real
 * traffic it 429s and charts went blank. From the browser each viewer has their own budget
 * (GeckoTerminal allows CORS). Used only when the API comes back empty or fails.
 */
const NETWORK = { solana: 'solana', 8453: 'base', 56: 'bsc' } as const;
export type GeckoNetwork = (typeof NETWORK)[keyof typeof NETWORK];

export function geckoNetworkFor(source: { kind: 'solana' } | { kind: 'evm'; chainId: number }): GeckoNetwork | null {
  if (source.kind === 'solana') return 'solana';
  return (NETWORK as Record<number, GeckoNetwork>)[source.chainId] ?? null;
}

const OHLCV: Record<Timeframe, { unit: 'minute' | 'hour' | 'day'; aggregate: number; limit: number }> = {
  '1m': { unit: 'minute', aggregate: 1, limit: 200 },
  '5m': { unit: 'minute', aggregate: 5, limit: 200 },
  '1H': { unit: 'hour', aggregate: 1, limit: 200 },
  '4H': { unit: 'hour', aggregate: 4, limit: 200 },
  '1D': { unit: 'day', aggregate: 1, limit: 200 },
  '1W': { unit: 'day', aggregate: 1, limit: 365 },
  '1M': { unit: 'day', aggregate: 1, limit: 1000 },
};

const API = 'https://api.geckoterminal.com/api/v2/networks';
const poolCache = new Map<string, Promise<string | null>>();

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The coin's top pool on GeckoTerminal (they list most liquid first), remembered per page. */
function topPool(network: GeckoNetwork, token: string): Promise<string | null> {
  const key = `${network}:${token}`;
  let pending = poolCache.get(key);
  if (!pending) {
    pending = getJson<{ data?: { attributes?: { address?: string } }[] }>(`${API}/${network}/tokens/${token}/pools?page=1`).then(
      (body) => body?.data?.find((p) => p.attributes?.address)?.attributes?.address ?? null,
    );
    // A miss (rate limit, brand-new coin) is retried on the next load, not remembered.
    pending.then((pool) => pool ?? poolCache.delete(key));
    poolCache.set(key, pending);
  }
  return pending;
}

/** Exported for tests. GeckoTerminal's [unixSeconds, o, h, l, c, volumeUsd] rows (newest first) → candles, oldest first. */
export function toCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is number[] => Array.isArray(r) && r.length >= 6 && r.slice(0, 6).every((v) => typeof v === 'number' && Number.isFinite(v)))
    .map(([ts, open, high, low, close, volumeUsd]) => ({ bucketStart: new Date(ts! * 1000).toISOString(), open: open!, high: high!, low: low!, close: close!, volumeUsd: volumeUsd! }))
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

/** `pool`: the coin's chart pool when known (from its live price), so these candles match Live/10s. */
export async function fetchGeckoCandles(network: GeckoNetwork, token: string, timeframe: Timeframe, pool?: string): Promise<Candle[]> {
  pool = pool ?? (await topPool(network, token)) ?? undefined;
  if (!pool) return [];
  const { unit, aggregate, limit } = OHLCV[timeframe];
  const body = await getJson<{ data?: { attributes?: { ohlcv_list?: unknown } } }>(
    `${API}/${network}/pools/${pool}/ohlcv/${unit}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=${token}`,
  );
  return toCandles(body?.data?.attributes?.ohlcv_list);
}

export interface GeckoTrade {
  txHash: string;
  side: 'BUY' | 'SELL';
  amountUsd: number;
  trader: string;
  atMs: number;
}

/** Exported for tests. GeckoTerminal's pool trades → this coin's buys/sells, newest first. The
 *  side comes from which way the coin moved (to the trader = buy), so it's right whichever
 *  side of the pool the coin is. */
export function toTrades(rows: unknown, token: string): GeckoTrade[] {
  if (!Array.isArray(rows)) return [];
  const want = token.toLowerCase();
  const out: GeckoTrade[] = [];
  for (const row of rows as { attributes?: Record<string, unknown> }[]) {
    const a = row?.attributes;
    if (!a) continue;
    const to = String(a.to_token_address ?? '').toLowerCase();
    const from = String(a.from_token_address ?? '').toLowerCase();
    const side = to === want ? 'BUY' : from === want ? 'SELL' : null;
    const amountUsd = Number(a.volume_in_usd);
    const atMs = Date.parse(String(a.block_timestamp ?? ''));
    if (!side || !Number.isFinite(amountUsd) || !Number.isFinite(atMs) || typeof a.tx_hash !== 'string') continue;
    out.push({ txHash: a.tx_hash, side, amountUsd, trader: String(a.tx_from_address ?? ''), atMs });
  }
  return out.sort((x, y) => y.atMs - x.atMs);
}

/** The coin's latest trades on its chart pool (or its top pool), from the viewer's browser. */
export async function fetchGeckoTrades(network: GeckoNetwork, token: string, pool?: string): Promise<GeckoTrade[] | null> {
  pool = pool ?? (await topPool(network, token)) ?? undefined;
  if (!pool) return null;
  const body = await getJson<{ data?: unknown }>(`${API}/${network}/pools/${pool}/trades`);
  return body ? toTrades(body.data, token) : null;
}
