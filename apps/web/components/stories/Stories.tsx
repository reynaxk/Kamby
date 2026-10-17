'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { STORY_LIMITS, type LiveRoom, type StoryPerson } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { API_BASE, authedFetch, hasStoredSession } from '@/lib/session-client';
import { marketHref } from '@/lib/solana-links';
import { cashtag, formatPercent, formatRelativeTime, formatSignedCompactUsd } from '@/lib/format';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { GoLiveSheet } from '@/components/live/GoLive';
import { fetchLiveRooms } from '@/lib/live-engine';

const SEEN_KEY = 'kamby:stories-seen';
const K_PATHS = ['M186 140 V372', 'M200 268 L338 140', 'M232 246 L346 372'];

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function markSeen(id: string): void {
  try {
    const seen = readSeen();
    seen.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-400)));
  } catch {
    // storage blocked — rings just stay bright
  }
}

async function fetchStories(): Promise<StoryPerson[]> {
  const res = hasStoredSession() ? await authedFetch('/social/stories') : await fetch(`${API_BASE}/v1/social/stories`);
  if (!res.ok) return [];
  return (await res.json()) as StoryPerson[];
}

/**
 * Stories (2026-10-17): a row of rings on Home, one per trader with a winning sell in the last
 * 24 hours (people you follow first). A neon ring = something you haven't seen. Tap one and
 * their wins play full-screen as PnL cards, Instagram-style: tap the right side for the next,
 * the left for the previous, hold to pause, Buy to open the coin. Hidden when nobody won today.
 */
export function StoriesRow() {
  const t = useTranslations('stories');
  const [stories, setStories] = useState<StoryPerson[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [live, setLive] = useState<LiveRoom[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [goLive, setGoLive] = useState(false);

  useEffect(() => {
    setSeen(readSeen());
    setSignedIn(hasStoredSession());
    let cancelled = false;
    fetchStories()
      .then((s) => !cancelled && setStories(s))
      .catch(() => undefined);
    // Who's live right now — refreshed every half minute while Home is open.
    const loadLive = () =>
      fetchLiveRooms()
        .then((r) => !cancelled && setLive(r))
        .catch(() => undefined);
    void loadLive();
    const timer = setInterval(() => document.visibilityState === 'visible' && void loadLive(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (stories.length === 0 && live.length === 0 && !signedIn) return null;
  return (
    <>
      <div className="kamby-rise -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="list" aria-label={t('title')}>
        {/* Go live (yours, first — like Instagram's "Your story") */}
        {signedIn && (
          <button type="button" role="listitem" onClick={() => setGoLive(true)} className="flex w-[4.4rem] shrink-0 flex-col items-center gap-1.5 active:scale-95">
            <span className="relative flex h-[4.15rem] w-[4.15rem] items-center justify-center rounded-full border-2 border-dashed border-[#FF3B69]/60 bg-[#FF3B69]/[0.08] text-[#FF3B69]">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="2.5" />
                <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" />
              </svg>
            </span>
            <span className="w-full truncate text-center font-body text-[0.68rem] font-semibold text-[#FF8FA8]">{t('goLive')}</span>
          </button>
        )}
        {/* Who's live */}
        {live.map((r) => (
          <Link key={r.id} href={`/live/${r.id}`} role="listitem" className="flex w-[4.4rem] shrink-0 flex-col items-center gap-1.5 active:scale-95">
            <span className="relative rounded-full bg-[conic-gradient(from_200deg,#FF3B69,#FF8A00,#FF3B69)] p-[2.5px]">
              <span className="block rounded-full bg-bg p-[2px]">
                <DmAvatar name={r.host.username} src={r.host.avatarUrl} className="h-14 w-14 text-lg" />
              </span>
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-md bg-[#FF3B69] px-1.5 py-px font-display text-[0.55rem] font-black tracking-wider text-white ring-2 ring-bg">LIVE</span>
            </span>
            <span className="w-full truncate text-center font-body text-[0.68rem] text-ink-600">{r.host.username}</span>
          </Link>
        ))}
        {stories.map((s, i) => {
          const fresh = s.cards.some((c) => !seen.has(c.id));
          return (
            <button key={s.userId} type="button" role="listitem" onClick={() => setOpen(i)} className="flex w-[4.4rem] shrink-0 flex-col items-center gap-1.5 active:scale-95">
              <span className={cn('rounded-full p-[2.5px]', fresh ? 'bg-[conic-gradient(from_200deg,#00FF87,#00E5FF,#7C5CFF,#00FF87)]' : 'bg-white/15')}>
                <span className="block rounded-full bg-bg p-[2px]">
                  <DmAvatar name={s.username} src={s.avatarUrl} className="h-14 w-14 text-lg" />
                </span>
              </span>
              <span className="w-full truncate text-center font-body text-[0.68rem] text-ink-600">{s.username}</span>
            </button>
          );
        })}
      </div>
      <GoLiveSheet open={goLive} onClose={() => setGoLive(false)} />
      {open !== null && (
        <StoryViewer
          stories={stories}
          start={open}
          onSeen={(id) => {
            markSeen(id);
            setSeen((prev) => new Set(prev).add(id));
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function StoryViewer({ stories, start, onSeen, onClose }: { stories: StoryPerson[]; start: number; onSeen: (id: string) => void; onClose: () => void }) {
  const t = useTranslations('stories');
  const [person, setPerson] = useState(start);
  const [card, setCard] = useState(() => {
    const seen = readSeen();
    const firstNew = stories[start]!.cards.findIndex((c) => !seen.has(c.id));
    return firstNew >= 0 ? firstNew : 0;
  });
  const [progress, setProgress] = useState(0);
  const paused = useRef(false);
  const s = stories[person]!;
  const c = s.cards[card]!;

  const next = useCallback(() => {
    setProgress(0);
    if (card + 1 < s.cards.length) setCard(card + 1);
    else if (person + 1 < stories.length) {
      setPerson(person + 1);
      setCard(0);
    } else onClose();
  }, [card, person, s.cards.length, stories.length, onClose]);
  const prev = useCallback(() => {
    setProgress(0);
    if (card > 0) setCard(card - 1);
    else if (person > 0) {
      setPerson(person - 1);
      setCard(0);
    }
  }, [card, person]);

  useEffect(() => onSeen(c.id), [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const step = 50;
    const timer = setInterval(() => {
      if (paused.current) return;
      setProgress((p) => {
        const n = p + step / (STORY_LIMITS.secondsPerCard * 1000);
        if (n >= 1) {
          queueMicrotask(next);
          return 0;
        }
        return n;
      });
    }, step);
    return () => clearInterval(timer);
  }, [next]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' ? onClose() : e.key === 'ArrowRight' ? next() : e.key === 'ArrowLeft' ? prev() : undefined);
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [next, prev, onClose]);

  const up = c.pnlUsd >= 0;
  const href = marketHref(c.chainIdentifier, c.tokenAddress);
  const chain = badgeChainFor(c.chainIdentifier);

  return createPortal(
    <div className="kamby-void fixed inset-0 z-[90] flex items-center justify-center bg-black" role="dialog" aria-label={t('title')}>
      <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden md:h-[92vh] md:rounded-3xl" style={{ background: 'linear-gradient(170deg,#141B4D 0%,#0A0E26 42%,#05070A 100%)' }}>
        <svg className="pointer-events-none absolute -right-16 top-24" width="380" height="380" viewBox="0 0 512 512" aria-hidden>
          <g fill="none" stroke="#00FF87" strokeWidth="92" strokeLinecap="round" opacity="0.07">
            {K_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </svg>

        {/* Progress + who */}
        <div className="relative z-10 px-3 pt-[calc(env(safe-area-inset-top)+0.6rem)]">
          <div className="flex gap-1">
            {s.cards.map((x, i) => (
              <span key={x.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
                <span className="block h-full rounded-full bg-white" style={{ width: `${i < card ? 100 : i === card ? progress * 100 : 0}%` }} />
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2.5">
            <DmAvatar name={s.username} src={s.avatarUrl} className="h-9 w-9 text-sm" />
            {s.walletAddress ? (
              <Link href={`/trader/${s.walletAddress}`} onClick={onClose} className="font-display text-sm font-bold text-white">
                @{s.username}
              </Link>
            ) : (
              <span className="font-display text-sm font-bold text-white">@{s.username}</span>
            )}
            <span className="font-body text-xs text-white/50">{formatRelativeTime(c.at)}</span>
            <button type="button" onClick={onClose} aria-label={t('close')} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-white/80 active:bg-white/10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* The win */}
        <div className="relative z-0 flex flex-1 flex-col justify-center px-7">
          <div className="flex items-center gap-3">
            <span className="relative">
              <TokenAvatar src={c.logoUrl} seed={c.tokenAddress} label={c.symbol ?? c.tokenAddress} className="h-14 w-14 text-lg" />
              {chain && <ChainBadge chain={chain} className="h-4 w-4 ring-[#0A0E26]" />}
            </span>
            <span>
              <span className="block font-display text-2xl font-black text-white">{cashtag(c.symbol ?? c.tokenAddress.slice(0, 6))}</span>
              <span className="block font-body text-xs font-semibold uppercase tracking-wider text-white/45">{t('realized')}</span>
            </span>
          </div>
          <p className={cn('mt-8 font-display text-[4.5rem] font-black leading-none tracking-tight', up ? 'text-[#00FF87]' : 'text-[#FF3B69]')}>{formatPercent(c.pnlPct)}</p>
          <p className={cn('mt-3 font-body text-2xl font-bold tabular-nums', up ? 'text-[#00FF87]' : 'text-[#FF3B69]')}>{formatSignedCompactUsd(c.pnlUsd)}</p>
          <p className="mt-6 font-body text-sm text-white/55">{t('invested', { amount: formatSignedCompactUsd(c.investedUsd).replace(/^\+/, '') })}</p>
        </div>

        {/* Tap zones (behind the buttons) */}
        <button
          type="button"
          aria-label={t('previous')}
          className="absolute inset-y-24 left-0 z-[1] w-1/3"
          onClick={prev}
          onPointerDown={() => (paused.current = true)}
          onPointerUp={() => (paused.current = false)}
          onPointerLeave={() => (paused.current = false)}
        />
        <button
          type="button"
          aria-label={t('next')}
          className="absolute inset-y-24 right-0 z-[1] w-2/3"
          onClick={next}
          onPointerDown={() => (paused.current = true)}
          onPointerUp={() => (paused.current = false)}
          onPointerLeave={() => (paused.current = false)}
        />

        {/* Actions */}
        <div className="relative z-10 flex gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {href && (
            <Link href={href} onClick={onClose} className="flex-1 rounded-2xl bg-[#00FF87] py-3.5 text-center font-display text-base font-black text-black active:scale-[0.98]">
              {t('buy', { symbol: cashtag(c.symbol ?? '') })}
            </Link>
          )}
          {s.walletAddress && (
            <Link href={`/trader/${s.walletAddress}`} onClick={onClose} className="rounded-2xl bg-white/10 px-5 py-3.5 font-display text-sm font-bold text-white active:scale-[0.98]">
              {t('profile')}
            </Link>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
