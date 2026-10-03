import type { Candle, Timeframe } from '@kamby/domain';

/** GeckoTerminal's network ids for the EVM chains Kamby lists aggregator-priced coins on. */
export const GECKO_NETWORK_BY_CHAIN_ID: Record<number, string> = { 8453: 'base', 56: 'bsc' };

const OHLCV: Record<Timeframe, { unit: 'minute' | 'hour' | 'day'; aggregate: number; limit: number }> = {
  '1m': { unit: 'minute', aggregate: 1, limit: 200 },
  '5m': { unit: 'minute', aggregate: 5, limit: 200 },
  '1H': { unit: 'hour', aggregate: 1, limit: 200 },
  '4H': { unit: 'hour', aggregate: 4, limit: 200 },
  '1D': { unit: 'day', aggregate: 1, limit: 200 },
  '1W': { unit: 'day', aggregate: 1, limit: 365 },
  '1M': { unit: 'day', aggregate: 1, limit: 1000 },
};

/** Cache lifetimes per width — short widths move fast; daily candles barely change. */
export const GECKO_OHLCV_TTL_SECONDS: Record<Timeframe, number> = { '1m': 30, '5m': 30, '1H': 60, '4H': 120, '1D': 300, '1W': 600, '1M': 600 };

/**
 * Candles for an aggregator-priced coin (one Kamby doesn't index swaps for — see
 * apps/workers/src/market/aggregator-markets.ts) straight from GeckoTerminal's free OHLCV, priced
 * in USD for `tokenAddress` within `pool`. Returns [] on any failure; callers cache.
 */
export async function fetchPoolCandles(network: string, pool: string, tokenAddress: string, timeframe: Timeframe): Promise<Candle[]> {
  const { unit, aggregate, limit } = OHLCV[timeframe];
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool}/ohlcv/${unit}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=${tokenAddress}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: unknown } } };
    const rows = body.data?.attributes?.ohlcv_list;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r): r is number[] => Array.isArray(r) && r.length >= 6 && r.slice(0, 6).every((v) => typeof v === 'number' && Number.isFinite(v)))
      .map(([ts, open, high, low, close, volumeUsd]) => ({ bucketStart: new Date(ts! * 1000).toISOString(), open: open!, high: high!, low: low!, close: close!, volumeUsd: volumeUsd! }))
      .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
  } catch {
    return [];
  }
}
