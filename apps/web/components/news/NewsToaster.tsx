'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { CHAIN_REGISTRY, isChainSlug, newsTokenKey, type NewsItem } from '@kamby/domain';
import { getNewsAlertPrefs, onNewsAlertPrefsChange, subscribeToNews, type NewsAlertPrefs } from '@/lib/news-client';
import { fetchWatchlist, hasStoredSession } from '@/lib/watchlist-client';
import { fetchMyPositions } from '@/lib/discovery-client';
import { NewsSourceMark, NewsTokenBadge } from './NewsCard';

const AUTO_DISMISS_MS = 9_000;
const MAX_TOASTS = 3;
const WATCHLIST_REFRESH_MS = 5 * 60_000;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

type Reason = 'holding' | 'watchlist' | 'onScreen';
interface Toast {
  item: NewsItem;
  reason: Reason;
}

/** Exported for tests. The coin open on this page (chain + address key), if any. */
export function coinKeyFromLocation(pathname: string, search: string): string | null {
  const market = /^\/market\/([^/]+)\/([^/?#]+)/.exec(pathname);
  if (market && isChainSlug(market[1]!)) return newsTokenKey(CHAIN_REGISTRY[market[1]!].identifier, decodeURIComponent(market[2]!));
  if (pathname === '/solana') return newsTokenKey('solana', new URLSearchParams(search).get('mint') || SOL_MINT);
  return null;
}

/** Exported for tests. Why this headline deserves a toast, or null (most don't). */
export function toastReason(item: NewsItem, watched: ReadonlySet<string>, onScreen: string | null, held: ReadonlySet<string> = new Set()): Reason | null {
  const keys = item.tokens.map((t) => newsTokenKey(t.chainIdentifier, t.tokenAddress));
  if (keys.some((k) => held.has(k))) return 'holding';
  if (keys.some((k) => watched.has(k))) return 'watchlist';
  if (onScreen && keys.includes(onScreen)) return 'onScreen';
  return null;
}

/** A short two-note chime — Web Audio, no file to load. */
function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.12;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // Audio blocked until the user interacts — the toast still shows.
  }
}

/**
 * News alerts (2026-10-31): a toast when a new headline mentions a coin you hold, one on your
 * watchlist, or the coin you have open — nothing for the rest, so it never turns into noise. Off/sound switches
 * live in notification settings (this browser).
 */
export function NewsToaster() {
  const t = useTranslations('news');
  const [prefs, setPrefs] = useState<NewsAlertPrefs | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const watched = useRef<Set<string>>(new Set());
  const held = useRef<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setPrefs(getNewsAlertPrefs());
    return onNewsAlertPrefsChange(setPrefs);
  }, []);

  const enabled = prefs?.toasts === true;
  const sound = prefs?.sound === true;

  // Coins you hold and watch, refreshed now and then.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      if (!hasStoredSession()) return;
      fetchWatchlist({ limit: 100 })
        .then((page) => {
          if (!cancelled) watched.current = new Set(page.items.map((w) => newsTokenKey(w.chainIdentifier, w.tokenAddress)));
        })
        .catch(() => undefined);
      fetchMyPositions()
        .then((positions) => {
          if (cancelled) return;
          held.current = new Set(
            positions
              .filter((p) => p.quantity > 0)
              .map((p) => newsTokenKey(p.chainIdentifier ?? (p.chain === 'solana' ? 'solana' : 'eip155:8453'), p.tokenAddress)),
          );
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, WATCHLIST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timerMap = timers.current;
    const unsubscribe = subscribeToNews((item) => {
      const reason = toastReason(item, watched.current, coinKeyFromLocation(window.location.pathname, window.location.search), held.current);
      if (!reason) return;
      setToasts((prev) => (prev.some((p) => p.item.id === item.id) ? prev : [{ item, reason }, ...prev].slice(0, MAX_TOASTS)));
      timerMap.set(item.id, setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS));
      if (sound) chime();
    });
    return () => {
      unsubscribe();
      for (const timer of timerMap.values()) clearTimeout(timer);
      timerMap.clear();
    };
  }, [enabled, sound]);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((p) => p.item.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[85] flex flex-col items-center gap-2 px-4 md:left-auto md:right-4 md:items-end md:px-0">
      {toasts.map(({ item, reason }) => (
        <div
          key={item.id}
          role="status"
          className="pointer-events-auto w-full max-w-sm rounded-2xl border border-accent/40 bg-surface-raised/95 p-3 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent px-2 py-0.5 font-display text-[0.65rem] font-bold uppercase tracking-wide text-bg">
              {reason === 'holding' ? t('toastHolding') : reason === 'watchlist' ? t('toastWatchlist') : t('toastOnScreen')}
            </span>
            <NewsSourceMark sourceId={item.sourceId} />
            <button type="button" onClick={() => dismiss(item.id)} aria-label={t('dismiss')} className="ml-auto rounded-full p-1 text-ink-400 hover:text-ink-900">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" onClick={() => dismiss(item.id)} className="mt-1.5 block font-display text-sm font-bold leading-snug text-ink-900 hover:text-accent">
            {item.title}
          </a>
          {item.tokens.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tokens.map((token) => (
                <NewsTokenBadge key={`${token.chainIdentifier}:${token.tokenAddress}`} token={token} onNavigate={() => dismiss(item.id)} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
