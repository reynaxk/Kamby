'use client';

import { useEffect, useState } from 'react';
import type { MarketFeedEvents, MarketFeedSnapshot, PumpFunLiveBatch, PumpFunTokenSummary } from '@kamby/domain';
import { API_BASE } from './session-client';
import type { RealtimeStatus } from './social-client';

export type { MarketFeedSnapshot };

const SNAPSHOT_EVENTS = ['trending', 'graduated', 'trenches', 'bonding', 'xxxrisk', 'crypto'] as const;
const TRENCHES_MAX = 50;
const GRADUATED_PUMPFUN_MAX = 30;
/** A live update for a coin not already listed only joins Trenches if it's this new —
 *  otherwise it's an old curve that happened to trade, which the next snapshot places. */
const NEW_LAUNCH_WINDOW_MS = 10 * 60_000;

type Listener = (type: string, data: unknown) => void;
const listeners = new Set<Listener>();
const statusListeners = new Set<(status: RealtimeStatus) => void>();
let source: EventSource | null = null;
let lastStatus: RealtimeStatus = 'connecting';
/** Resilience (2026-10-04 audit). A browser's EventSource retries a dropped connection by
 *  itself — but not one the server answered with an error (a 502 while the API redeploys, a
 *  429): that closes it for good, and every open tab sat on a dead feed until reloaded. It
 *  also never notices a silently stalled connection (Wi-Fi switch, sleep). So: reconnect a
 *  closed stream with backoff, restart one that's been silent past two heartbeats (the API
 *  sends one every 25s), and reconnect at once when the browser comes back online. */
const STALL_MS = 60_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
let lastEventAt = 0;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;

function reconnectSoon(delayMs: number): void {
  if (retryTimer || listeners.size === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (listeners.size === 0) return;
    source?.close();
    connect();
  }, delayMs);
}

function onBackOnline(): void {
  if (listeners.size > 0 && lastStatus !== 'live') {
    retries = 0;
    reconnectSoon(0);
  }
}

function setStatus(status: RealtimeStatus): void {
  lastStatus = status;
  for (const listener of statusListeners) listener(status);
}

function connect(): void {
  const es = new EventSource(`${API_BASE}/v1/market/feeds/stream`);
  source = es;
  lastEventAt = Date.now();
  setStatus('connecting');
  for (const type of [...SNAPSHOT_EVENTS, 'pumpfun', 'prices'] as const) {
    es.addEventListener(type, (event) => {
      let data: unknown;
      try {
        data = JSON.parse((event as MessageEvent).data);
      } catch {
        return; // one malformed event — the next snapshot catches up
      }
      lastEventAt = Date.now();
      for (const listener of listeners) listener(type, data);
    });
  }
  es.addEventListener('heartbeat', () => {
    lastEventAt = Date.now();
    setStatus('live');
  });
  es.onopen = () => {
    lastEventAt = Date.now();
    retries = 0;
    setStatus('live');
  };
  es.onerror = () => {
    setStatus('reconnecting');
    // A transient drop retries on its own; a closed stream needs us.
    if (es.readyState === EventSource.CLOSED) reconnectSoon(BACKOFF_MS[Math.min(retries++, BACKOFF_MS.length - 1)]!);
  };
  if (!watchdog) {
    watchdog = setInterval(() => {
      if (listeners.size > 0 && document.visibilityState === 'visible' && Date.now() - lastEventAt > STALL_MS) {
        lastEventAt = Date.now();
        reconnectSoon(0);
      }
    }, 15_000);
    window.addEventListener('online', onBackOnline);
  }
}

/**
 * One EventSource per browser tab, however many components listen (the terminal's token
 * rail, the ticker bar, ...) — opened by the first subscriber, closed with the last. See
 * MarketFeedsService in apps/api for the server side.
 */
export function subscribeToMarketFeeds(listener: Listener, onStatus: (status: RealtimeStatus) => void): () => void {
  listeners.add(listener);
  statusListeners.add(onStatus);
  if (!source) connect();
  else onStatus(lastStatus);
  return () => {
    listeners.delete(listener);
    statusListeners.delete(onStatus);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (watchdog) clearInterval(watchdog);
      watchdog = null;
      window.removeEventListener('online', onBackOnline);
    }
  };
}

function upsertBy<T>(list: T[], item: T, key: (t: T) => string): { list: T[]; found: boolean } {
  const index = list.findIndex((existing) => key(existing) === key(item));
  if (index === -1) return { list, found: false };
  const next = list.slice();
  next[index] = item;
  return { list: next, found: true };
}

const byMint = (t: PumpFunTokenSummary) => t.mintAddress;
const normalizedTicker = (symbol: string | null) => symbol?.trim().replace(/^\$+/, '').toLowerCase() || null;

/** Exported for tests. Folds one Pump.fun live batch into the three tabs it touches. */
export function applyPumpFunBatch(state: MarketFeedSnapshot, batch: PumpFunLiveBatch, now = Date.now()): MarketFeedSnapshot {
  let trenches = state.trenches.tokens;
  let bonding = state.bonding.tokens;
  let graduated = state.graduated.pumpfun;
  for (const token of batch.tokens) {
    if (token.complete) {
      trenches = trenches.filter((t) => t.mintAddress !== token.mintAddress);
      bonding = bonding.filter((t) => t.mintAddress !== token.mintAddress);
      const replaced = upsertBy(graduated, token, byMint);
      graduated = replaced.found ? replaced.list : [token, ...graduated].slice(0, GRADUATED_PUMPFUN_MAX);
      continue;
    }
    const inTrenches = upsertBy(trenches, token, byMint);
    trenches = inTrenches.list;
    const inBonding = upsertBy(bonding, token, byMint);
    bonding = inBonding.list;
    // Same one-per-ticker rule the API applies to Trenches (distinctLaunches), so a wallet
    // mass-launching one name can't refill the tab between snapshots.
    const ticker = normalizedTicker(token.symbol);
    const tickerTaken = ticker !== null && trenches.some((t) => normalizedTicker(t.symbol) === ticker);
    if (!inTrenches.found && !inBonding.found && !tickerTaken && now - Date.parse(token.createdAt) < NEW_LAUNCH_WINDOW_MS) {
      trenches = [token, ...trenches].slice(0, TRENCHES_MAX);
    }
  }
  bonding = bonding.slice().sort((a, b) => b.graduationProgressPct - a.graduationProgressPct);
  return {
    ...state,
    trenches: { ...state.trenches, tokens: trenches },
    bonding: { ...state.bonding, tokens: bonding },
    graduated: { ...state.graduated, pumpfun: graduated },
  };
}

/** Exported for tests. Full snapshots replace their tab; `pumpfun` merges. */
/** Exported for tests. Patches a list's rows with a price-only update (see MarketFeedEvents.prices). */
export function applyPriceDelta(state: MarketFeedSnapshot, update: MarketFeedEvents['prices']): MarketFeedSnapshot {
  const current = state[update.tab];
  let changed = false;
  const markets = current.markets.map((m) => {
    const p = update.prices[`${m.chainIdentifier}:${m.tokenAddress}`];
    if (!p) return m;
    changed = true;
    return { ...m, priceUsd: p[0], marketCapUsd: p[1], priceChange24hPct: p[2], lastPriceUpdateAt: update.atIso };
  });
  return changed ? { ...state, [update.tab]: { ...current, markets, atIso: update.atIso } } : state;
}

export function applyFeedEvent(state: MarketFeedSnapshot, type: string, data: unknown): MarketFeedSnapshot {
  if (type === 'pumpfun') return applyPumpFunBatch(state, data as PumpFunLiveBatch);
  if (type === 'prices') return applyPriceDelta(state, data as MarketFeedEvents['prices']);
  if ((SNAPSHOT_EVENTS as readonly string[]).includes(type)) return { ...state, [type]: data };
  return state;
}

/** The terminal's five tabs, live. Starts from the server-rendered snapshot, so first paint
 *  never waits on the stream. */
export function useMarketFeeds(initial: MarketFeedSnapshot): { feeds: MarketFeedSnapshot; status: RealtimeStatus } {
  const [feeds, setFeeds] = useState(initial);
  const [status, setStatusState] = useState<RealtimeStatus>('connecting');
  useEffect(
    () => subscribeToMarketFeeds((type, data) => setFeeds((current) => applyFeedEvent(current, type, data)), setStatusState),
    [],
  );
  return { feeds, status };
}
