'use client';

import { memo, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DM_REACTIONS, dmMentions, looksLikeScamBait, type DmMessage, type DmPerson } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { PriceText } from '@/components/market/PriceText';
import { fetchLivePrice } from '@/lib/chart-data';
import { liveSourceFor } from '@/lib/use-live-price';
import { marketHref } from '@/lib/solana-links';
import { cashtag, formatPercent, formatSignedCompactUsd } from '@/lib/format';
import { TradeCard } from '@/components/social/TradeCard';
import { DuelCard } from '@/components/duels/DuelCard';
import { VoiceBubble } from './Voice';
import { DmAvatar } from './DmAvatar';
import { useSystemText } from './GroupBits';

const K_PATHS = ['M186 140 V372', 'M200 268 L338 140', 'M232 246 L346 372'];

/** Names in groups get their own colour (like Discord roles) so you can tell people apart at a
 *  glance — picked from the person's id, the same on every screen. */
const NAME_COLORS = ['#7DD3FC', '#F9A8D4', '#FCD34D', '#A5B4FC', '#86EFAC', '#FDBA74', '#C4B5FD', '#5EEAD4', '#FDA4AF', '#BEF264'];
export function nameColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(h) % NAME_COLORS.length]!;
}

/** A text with its @names picked out (bold, in the accent — or underlined on your own neon bubble). */
function BodyText({ body, mine }: { body: string; mine: boolean }) {
  // No regex look-behind (older iPhones can't parse it): an @name counts unless it's glued to a
  // word before it, like an email.
  const parts = body.split(/(@[a-z0-9_.]{3,21})/gi);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 && !/[a-z0-9_.]$/i.test(parts[i - 1] ?? '') ? (
          <span key={i} className={cn('font-bold', mine ? 'underline decoration-black/40 underline-offset-2' : 'rounded bg-accent/[0.12] px-0.5 text-accent')}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Jump to the line a reply quotes, with a short ring so the eye finds it. */
function jumpTo(id: string) {
  const el = document.getElementById(`dm-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('kamby-flash');
  void el.offsetWidth;
  el.classList.add('kamby-flash');
}

/** A tiny tap on phones that support it — reactions and sends feel physical. */
export function haptic(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
}

/** Coin cards share one price look-up per coin for a short while — a chat full of the same
 *  coin asks once, not once per card (2026-10-17). */
const PRICE_TTL_MS = 30_000;
const priceCache = new Map<string, { at: number; price: Promise<number | null> }>();
function cachedPrice(source: Parameters<typeof fetchLivePrice>[0], key: string): Promise<number | null> {
  const hit = priceCache.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.price;
  const price = fetchLivePrice(source)
    .then((live) => live?.priceUsd ?? null)
    .catch(() => null);
  priceCache.set(key, { at: Date.now(), price });
  return price;
}

function CoinCard({ m, mine }: { m: DmMessage; mine: boolean }) {
  const t = useTranslations('dm');
  const coin = m.coin!;
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    const source = liveSourceFor(coin);
    if (!source) return;
    let cancelled = false;
    void cachedPrice(source, `${coin.chainIdentifier}:${coin.tokenAddress}`).then((p) => !cancelled && p !== null && setPrice(p));
    return () => {
      cancelled = true;
    };
  }, [coin]);
  const href = marketHref(coin.chainIdentifier, coin.tokenAddress);
  const chain = badgeChainFor(coin.chainIdentifier);
  return (
    <div className={cn('w-64 overflow-hidden rounded-3xl border p-3.5', mine ? 'border-accent/25 bg-accent/[0.07]' : 'border-white/10 bg-white/[0.04]')}>
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          <TokenAvatar src={coin.logoUrl} seed={coin.tokenAddress} label={coin.symbol ?? coin.tokenAddress} className="h-11 w-11 text-sm" />
          {chain && <ChainBadge chain={chain} />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-base font-bold text-ink-900">{cashtag(coin.symbol ?? coin.tokenAddress.slice(0, 6))}</span>
          <span className="block truncate font-body text-xs text-ink-400">{coin.name ?? ''}</span>
        </span>
        <span className="ml-auto shrink-0 text-right font-display text-sm font-bold tabular-nums text-ink-900">
          <PriceText value={price} />
        </span>
      </div>
      {href && (
        <Link href={href} className="mt-3 flex items-center justify-center rounded-2xl bg-accent py-2.5 font-display text-sm font-bold text-black transition-transform active:scale-[0.98]">
          {t('buy')}
        </Link>
      )}
    </div>
  );
}

function PnlCard({ m }: { m: DmMessage }) {
  const p = m.pnl!;
  const up = p.pnlUsd >= 0;
  const href = marketHref(p.chainIdentifier, p.tokenAddress);
  const body = (
    <div className="relative w-64 overflow-hidden rounded-3xl border border-white/10 p-4" style={{ background: 'linear-gradient(165deg,#141B4D 0%,#0A0E26 45%,#020203 100%)' }}>
      <svg className="pointer-events-none absolute -right-10 -top-6" width="170" height="170" viewBox="0 0 512 512" aria-hidden>
        <g fill="none" stroke="#FFFFFF" strokeWidth="92" strokeLinecap="round" opacity="0.05">
          {K_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
      <div className="relative flex items-center gap-2">
        <TokenAvatar src={p.logoUrl} seed={p.tokenAddress} label={p.symbol ?? p.tokenAddress} className="h-8 w-8 text-xs" />
        <span className="font-display text-sm font-bold text-white">{cashtag(p.symbol ?? p.tokenAddress.slice(0, 6))}</span>
        <span className="ml-auto font-display text-[0.6rem] font-black tracking-tight text-white/50">KAMBY</span>
      </div>
      <p className={cn('relative mt-3 font-display text-4xl font-black leading-none tracking-tight', up ? 'text-up' : 'text-down')}>{formatPercent(p.pnlPct)}</p>
      <p className={cn('relative mt-1 font-body text-sm font-bold tabular-nums', up ? 'text-up' : 'text-down')}>{formatSignedCompactUsd(p.pnlUsd)}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function UsdcCard({ m, mine }: { m: DmMessage; mine: boolean }) {
  const t = useTranslations('dm');
  const u = m.usdc!;
  const chain = badgeChainFor(u.chainIdentifier);
  return (
    <div className="flex w-60 items-center gap-3 rounded-3xl border border-up/25 bg-up/[0.08] p-3.5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-up/15 text-xl" aria-hidden>
        💸
      </span>
      <span className="min-w-0">
        <span className="block font-display text-lg font-black tabular-nums text-up">${u.amountUsd.toFixed(2)}</span>
        <span className="flex items-center gap-1.5 font-body text-xs text-ink-400">
          {chain && (
            <span className="relative h-3.5 w-3.5">
              <ChainBadge chain={chain} className="!static !h-3.5 !w-3.5 !ring-0" />
            </span>
          )}
          {mine ? t('usdcSent') : t('usdcReceived')} ✓
        </span>
      </span>
    </div>
  );
}

/**
 * One private message (2026-10-17): your lines in neon on the right, theirs in glass on the
 * left; coin / PnL / USDC cards; reactions under it; tap a bubble for the reaction bar. A line
 * that looks like the classic seed-phrase / fake-support bait gets a warning under it.
 */
export const DmMessageView = memo(function DmMessageView({
  m,
  mine,
  me,
  first,
  last,
  onReact,
  onReply,
  meName = null,
  sender = null,
}: {
  m: DmMessage;
  mine: boolean;
  me: string | null;
  first: boolean;
  last: boolean;
  onReact: (messageId: string, emoji: string) => void;
  /** Swipe right (phones) or the ↩ in the reaction bar — answer this line. */
  onReply?: (m: DmMessage) => void;
  /** Your @name, so lines that mention you stand out. */
  meName?: string | null;
  /** In a group: who wrote it (shown above their first line). */
  sender?: DmPerson | null;
}) {
  const t = useTranslations('dm');
  const systemText = useSystemText();
  const [picking, setPicking] = useState(false);
  const [burst, setBurst] = useState(false);
  const [copied, setCopied] = useState(false);
  // Swipe-to-reply: the line follows your thumb a little, a ↩ fades in, let go past the mark.
  const [dx, setDx] = useState(0);
  const swipe = useRef<{ x: number; y: number; on: boolean } | null>(null);
  if (m.kind === 'system' && m.system) {
    return (
      <p className="my-3 text-center">
        <span className="inline-block rounded-full bg-white/[0.05] px-3 py-1 font-body text-[0.7rem] text-ink-400">{systemText(m.system)}</span>
      </p>
    );
  }
  const reactions = Object.entries(m.reactions).filter(([, who]) => who.length > 0);
  const bait = !mine && m.kind === 'text' && looksLikeScamBait(m.body);
  const mentionsMe = !mine && m.kind === 'text' && Boolean(meName) && dmMentions(m.body).includes(meName!.toLowerCase());
  const replyMark = 56;
  const onTouchStart = (e: React.TouchEvent) => {
    if (!onReply) return;
    const t0 = e.touches[0]!;
    if (t0.clientX < 30) return; // the left edge belongs to the community swipe
    swipe.current = { x: t0.clientX, y: t0.clientY, on: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = swipe.current;
    if (!s) return;
    const t0 = e.touches[0]!;
    const ddx = t0.clientX - s.x;
    if (!s.on) {
      if (Math.abs(t0.clientY - s.y) > 12) {
        swipe.current = null;
        return;
      }
      if (ddx > 10) s.on = true;
    }
    if (s.on) {
      const next = Math.max(0, Math.min(80, ddx * 0.7));
      if (next >= replyMark && dx < replyMark) haptic(6);
      setDx(next);
    }
  };
  const onTouchEnd = () => {
    if (swipe.current?.on && dx >= replyMark) onReply?.(m);
    swipe.current = null;
    setDx(0);
  };

  return (
    <div
      id={`dm-${m.id}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className={cn('kamby-chat-in relative flex flex-col rounded-2xl', mine ? 'items-end' : 'items-start', first ? 'mt-3' : 'mt-0.5', sender && !mine && 'pl-9')}
    >
      {dx > 0 && (
        <span
          className="pointer-events-none absolute left-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-accent/15 text-accent"
          style={{ opacity: Math.min(1, dx / replyMark), transform: `translateY(-50%) scale(${dx >= replyMark ? 1.1 : 0.8})` }}
          aria-hidden
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1" />
          </svg>
        </span>
      )}
      {sender && !mine && first && (
        <span className="relative mb-1 ml-1 font-display text-[0.72rem] font-bold" style={{ color: nameColor(sender.userId) }}>
          <DmAvatar name={sender.username} src={sender.avatarUrl} className="absolute -left-9 top-0 h-7 w-7 text-[0.65rem]" />
          {sender.username ? `@${sender.username}` : t('someone')}
        </span>
      )}
      {picking && (
        <div className="kamby-glass-solid kamby-sheet-solid mb-1 flex gap-1 rounded-full px-2 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)]" role="menu">
          {DM_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                haptic();
                onReact(m.id, e);
                setPicking(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 active:scale-90"
            >
              {e}
            </button>
          ))}
          {onReply && (
            <>
              <span className="mx-0.5 my-1.5 w-px bg-white/10" aria-hidden />
              <button
                type="button"
                aria-label={t('reply')}
                onClick={() => {
                  setPicking(false);
                  onReply(m);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-600 transition-transform hover:scale-110 active:scale-90"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1" />
                </svg>
              </button>
            </>
          )}
          {m.kind === 'text' && (
            <button
              type="button"
              aria-label={t('copy')}
              onClick={() => {
                void navigator.clipboard?.writeText(m.body).catch(() => undefined);
                setCopied(true);
                setTimeout(() => {
                  setCopied(false);
                  setPicking(false);
                }, 700);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-600 transition-transform hover:scale-110 active:scale-90"
            >
              {copied ? (
                <span className="text-sm text-accent">✓</span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              )}
            </button>
          )}
        </div>
      )}
      {m.replyTo && (
        <button
          type="button"
          onClick={() => jumpTo(m.replyTo!.id)}
          className={cn('mb-0.5 flex max-w-[75%] items-stretch gap-2 rounded-2xl bg-white/[0.04] py-1.5 pl-2 pr-3 text-left transition-colors active:bg-white/[0.08]', mine ? 'mr-1' : 'ml-1')}
          style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        >
          <span className="w-0.5 shrink-0 rounded-full" style={{ background: nameColor(m.replyTo.senderId) }} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-display text-[0.68rem] font-bold" style={{ color: nameColor(m.replyTo.senderId) }}>
              {m.replyTo.senderId === me ? t('you') : m.replyTo.username ? `@${m.replyTo.username}` : t('someone')}
            </span>
            <span className="block truncate font-body text-xs text-ink-400">{m.replyTo.preview}</span>
          </span>
        </button>
      )}
      {/* A div, not a button: cards inside it have their own buttons / links (no nesting). */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setPicking((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setPicking((p) => !p);
          }
        }}
        onDoubleClick={() => {
          // Double-tap = ❤️ (Instagram-style), with a little burst.
          setPicking(false);
          if (!(me && m.reactions['❤️']?.includes(me))) {
            haptic(12);
            onReact(m.id, '❤️');
          }
          setBurst(true);
          setTimeout(() => setBurst(false), 650);
        }}
        className={cn('relative max-w-[80%] cursor-pointer touch-manipulation select-none text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-3xl', !dx && 'transition-transform duration-200')}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        aria-label={t('react')}
      >
        {burst && (
          <span className="kamby-heart-burst pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-4xl" aria-hidden>
            ❤️
          </span>
        )}
        {m.kind === 'text' ? (
          <span
            className={cn(
              'block whitespace-pre-wrap break-words px-4 py-2.5 font-body text-[0.95rem] leading-snug',
              mine
                ? cn('bg-accent text-black', 'rounded-3xl', !first && 'rounded-tr-lg', !last && 'rounded-br-lg')
                : cn(
                    mentionsMe ? 'border border-accent/40 bg-accent/[0.1] text-ink-900' : 'kamby-glass text-ink-900',
                    'rounded-3xl',
                    !first && 'rounded-tl-lg',
                    !last && 'rounded-bl-lg',
                  ),
            )}
          >
            <BodyText body={m.body} mine={mine} />
          </span>
        ) : m.kind === 'coin' && m.coin ? (
          <CoinCard m={m} mine={mine} />
        ) : m.kind === 'pnl' && m.pnl ? (
          <PnlCard m={m} />
        ) : m.kind === 'usdc' && m.usdc ? (
          <UsdcCard m={m} mine={mine} />
        ) : m.kind === 'voice' && m.voice ? (
          <VoiceBubble m={m} mine={mine} />
        ) : m.kind === 'duel' && m.duel ? (
          <DuelCard duelId={m.duel.duelId} minutes={m.duel.minutes} />
        ) : m.kind === 'trade' && m.trade ? (
          <TradeCard trade={m.trade} mine={mine} by={sender?.username ? `@${sender.username}` : null} />
        ) : null}
      </div>
      {reactions.length > 0 && (
        <div className={cn('-mt-1.5 flex gap-1', mine ? 'mr-2' : 'ml-2')}>
          {reactions.map(([emoji, who]) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                haptic();
                onReact(m.id, emoji);
              }}
              className={cn(
                'kamby-pop flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-transform active:scale-90',
                me && who.includes(me) ? 'border-accent/40 bg-[#0B1A12]' : 'border-white/10 bg-[#11131C]',
              )}
            >
              {emoji}
              {who.length > 1 && <span className="font-body text-[0.65rem] font-semibold text-ink-600">{who.length}</span>}
            </button>
          ))}
        </div>
      )}
      {bait && (
        <p className="mt-1 max-w-[80%] rounded-2xl border border-warn/30 bg-warn/[0.08] px-3 py-2 font-body text-xs leading-snug text-warn">⚠️ {t('scamWarning')}</p>
      )}
    </div>
  );
});
