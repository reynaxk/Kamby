'use client';

import { useEffect, useState } from 'react';
import type { MarketFeedSnapshot, PumpFunLiveBatch, PumpFunTokenSummary } from '@kamby/domain';
import { API_BASE } from './session-client';
import type { RealtimeStatus } from './social-client';

export type { MarketFeedSnapshot };

const SNAPSHOT_EVENTS = ['trending', 'graduated', 'trenches', 'bonding', 'crypto'] as const;
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

function setStatus(status: RealtimeStatus): void {
  lastStatus = status;
  for (const listener of statusListeners) listener(status);
}

function connect(): void {
  const es = new EventSource(`${API_BASE}/v1/market/feeds/stream`);
  source = es;
  setStatus('connecting');
  for (const type of [...SNAPSHOT_EVENTS, 'pumpfun'] as const) {
    es.addEventListener(type, (event) => {
      let data: unknown;
      try {
        data = JSON.parse((event as MessageEvent).data);
      } catch {
        return; // one malformed event — the next snapshot catches up
      }
      for (const listener of listeners) listener(type, data);
    });
  }
  es.addEventListener('heartbeat', () => setStatus('live'));
  es.onopen = () => setStatus('live');
  es.onerror = () => setStatus('reconnecting'); // EventSource retries on its own
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
export function applyFeedEvent(state: MarketFeedSnapshot, type: string, data: unknown): MarketFeedSnapshot {
  if (type === 'pumpfun') return applyPumpFunBatch(state, data as PumpFunLiveBatch);
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
