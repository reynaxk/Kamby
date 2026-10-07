'use client';

import type { Candle, LivePrice, Timeframe, TokenInfoChain } from '@kamby/domain';
import { API_BASE } from './session-client';
import { fetchTokenHistory } from './market-client';
import { fetchGeckoCandles, geckoNetworkFor } from './gecko-browser';

/** What the chart's timeframe tabs offer: a real-time price line plus the candle widths. */
export type ChartTimeframe = 'live' | '10s' | Timeframe;

/** Built in the browser from the 2s live-price feed (no candle API serves them — GeckoTerminal's
 *  second-level OHLCV is paid-only): the Live line and 10-second candles (added 2026-10-04). */
export function isTickTimeframe(tf: ChartTimeframe): tf is 'live' | '10s' {
  return tf === 'live' || tf === '10s';
}

/** The candle width fetched for a timeframe — tick timeframes seed from the last 1m candles. */
export function candleWidthFor(tf: ChartTimeframe): Timeframe {
  return isTickTimeframe(tf) ? '1m' : tf;
}

/** A coin as the chart needs it: which history API serves its candles, and its live-price key. */
export type ChartSource =
  | { kind: 'evm'; chain: 'base' | 'bnb'; address: string; chainId: number }
  | { kind: 'solana'; mint: string };

export function livePriceKey(source: ChartSource): { chain: TokenInfoChain; address: string } {
  return source.kind === 'solana' ? { chain: 'solana', address: source.mint } : { chain: source.chain, address: source.address };
}

/** How often an open chart refetches its candles, so the newest one keeps moving. */
export const CANDLE_REFRESH_MS: Partial<Record<Timeframe, number>> = { '1m': 10_000, '5m': 15_000, '1H': 30_000 };

/** The chart source for a Base/BNB coin by chain id. */
export function evmChartSource(address: string, chainId: number): ChartSource {
  return { kind: 'evm', chain: chainId === 56 ? 'bnb' : 'base', address, chainId };
}

/** How long fetched candles count as fresh — short widths move fast. */
function freshForMs(timeframe: Timeframe): number {
  return timeframe === '1m' || timeframe === '5m' ? 8_000 : 25_000;
}

const candleCache = new Map<string, { candles: Candle[]; at: number }>();
const inFlight = new Map<string, Promise<Candle[]>>();

function cacheKey(source: ChartSource, timeframe: Timeframe): string {
  return source.kind === 'solana' ? `sol:${source.mint}:${timeframe}` : `${source.chainId}:${source.address.toLowerCase()}:${timeframe}`;
}

/** Candles already on hand for this coin + width (possibly stale), for an instant first paint. */
export function cachedCandles(source: ChartSource, timeframe: Timeframe): Candle[] | null {
  return candleCache.get(cacheKey(source, timeframe))?.candles ?? null;
}

export function primeCandles(source: ChartSource, timeframe: Timeframe, candles: Candle[]): void {
  const key = cacheKey(source, timeframe);
  if (!candleCache.has(key)) candleCache.set(key, { candles, at: Date.now() });
}

/**
 * Candles for a coin, shared across every chart on the page: served from memory while fresh,
 * one request at a time per coin + width. Switching timeframes back and forth is instant.
 */
export function loadCandles(source: ChartSource, timeframe: Timeframe, { force = false } = {}): Promise<Candle[]> {
  const key = cacheKey(source, timeframe);
  const hit = candleCache.get(key);
  if (!force && hit && Date.now() - hit.at < freshForMs(timeframe)) return Promise.resolve(hit.candles);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = fetchWithFallback(source, timeframe)
    .then((candles) => {
      candleCache.set(key, { candles, at: Date.now() });
      return candles;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** Too few candles to draw a chart — a brand-new coin, or the API was rate-limited upstream. */
const MIN_USEFUL_CANDLES = 2;

/** The API first (cached, shared by every viewer); if it has nothing, GeckoTerminal from this browser. */
async function fetchWithFallback(source: ChartSource, timeframe: Timeframe): Promise<Candle[]> {
  let fromApi: Candle[] = [];
  let apiError: unknown = null;
  try {
    fromApi = source.kind === 'solana' ? await fetchSolanaCandles(source.mint, timeframe) : await fetchTokenHistory(source.address, timeframe, source.chainId);
  } catch (error) {
    apiError = error;
  }
  if (fromApi.length >= MIN_USEFUL_CANDLES) return fromApi;
  const network = geckoNetworkFor(source);
  // The pool the live price reports is the coin's chart pool — the same market as Live/10s.
  const pool = network ? await fetchLivePrice(source).then((p) => p?.poolAddress).catch(() => undefined) : undefined;
  const fromGecko = network ? await fetchGeckoCandles(network, source.kind === 'solana' ? source.mint : source.address, timeframe, pool) : [];
  if (fromGecko.length > fromApi.length) return fromGecko;
  if (apiError && fromApi.length === 0) throw apiError;
  return fromApi;
}

async function fetchSolanaCandles(mint: string, timeframe: Timeframe): Promise<Candle[]> {
  const res = await fetch(`${API_BASE}/v1/market/solana/${encodeURIComponent(mint)}/history?timeframe=${timeframe}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Failed to fetch candles (${res.status})`);
  return res.json();
}

/** The pushed live-price stream's URL (LivePriceService#stream) — see subscribeLivePrice. */
export function livePriceStreamUrl(source: ChartSource): string {
  const { chain, address } = livePriceKey(source);
  return `${API_BASE}/v1/market/live-price/${chain}/${encodeURIComponent(address)}/stream`;
}

/** The latest live price, or null when the API has none yet (an empty body). */
export async function fetchLivePrice(source: ChartSource): Promise<LivePrice | null> {
  const { chain, address } = livePriceKey(source);
  const res = await fetch(`${API_BASE}/v1/market/live-price/${chain}/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`Failed to fetch live price (${res.status})`);
  const text = await res.text();
  return text ? (JSON.parse(text) as LivePrice) : null;
}

/** Test seam. */
export function resetChartDataCache(): void {
  candleCache.clear();
  inFlight.clear();
}
