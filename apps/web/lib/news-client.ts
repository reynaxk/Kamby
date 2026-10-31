'use client';

import type { NewsItem, NewsPage } from '@kamby/domain';
import { API_BASE } from './session-client';

/**
 * Crypto news (2026-10-31) — headlines the workers poll from public RSS feeds. Reads are
 * public; new headlines arrive over one small SSE stream per tab (event `news`), shared by
 * every component that listens (the news list, the coin ticker line, the alert toasts).
 */

export async function fetchNews(params: { chainIdentifier?: string; tokenAddress?: string; before?: string; limit?: number } = {}, signal?: AbortSignal): Promise<NewsPage> {
  const query = new URLSearchParams();
  if (params.chainIdentifier && params.tokenAddress) {
    query.set('chain', params.chainIdentifier);
    query.set('address', params.tokenAddress);
  }
  if (params.before) query.set('before', params.before);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await fetch(`${API_BASE}/v1/news?${query.toString()}`, { signal });
  if (!res.ok) throw new Error(`news ${res.status}`);
  return res.json();
}

type Listener = (item: NewsItem) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

function connect(): void {
  const es = new EventSource(`${API_BASE}/v1/news/stream`);
  source = es;
  es.addEventListener('news', (event) => {
    let item: NewsItem;
    try {
      item = JSON.parse((event as MessageEvent).data) as NewsItem;
    } catch {
      return;
    }
    for (const listener of listeners) listener(item);
  });
  es.onopen = () => {
    retries = 0;
  };
  es.onerror = () => {
    // A closed stream (the API answered with an error while redeploying) never retries by itself.
    if (es.readyState !== EventSource.CLOSED || retryTimer || listeners.size === 0) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (listeners.size > 0 && source === es) connect();
    }, BACKOFF_MS[Math.min(retries++, BACKOFF_MS.length - 1)]!);
  };
}

/** New headlines as they land. One EventSource per tab, opened by the first listener. */
export function subscribeToNews(listener: Listener): () => void {
  listeners.add(listener);
  if (!source) connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
}

// --- Alert preferences (this browser) -------------------------------------------------------

export interface NewsAlertPrefs {
  /** A toast when a headline mentions a watched coin or the coin on screen. */
  toasts: boolean;
  /** A short chime with those toasts. */
  sound: boolean;
}

const PREFS_KEY = 'kamby:news-alerts';
const PREFS_EVENT = 'kamby:news-alerts-changed';
export const DEFAULT_NEWS_ALERT_PREFS: NewsAlertPrefs = { toasts: true, sound: false };

export function getNewsAlertPrefs(): NewsAlertPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_NEWS_ALERT_PREFS;
    const parsed = JSON.parse(raw) as Partial<NewsAlertPrefs>;
    return { toasts: parsed.toasts !== false, sound: parsed.sound === true };
  } catch {
    return DEFAULT_NEWS_ALERT_PREFS;
  }
}

export function setNewsAlertPrefs(prefs: NewsAlertPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode — the change still applies to this page view.
  }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: prefs }));
}

export function onNewsAlertPrefsChange(listener: (prefs: NewsAlertPrefs) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<NewsAlertPrefs>).detail);
  window.addEventListener(PREFS_EVENT, handler);
  return () => window.removeEventListener(PREFS_EVENT, handler);
}
