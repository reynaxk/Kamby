'use client';

import { memo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DM_REACTIONS, looksLikeScamBait, type DmMessage } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { PriceText } from '@/components/market/PriceText';
import { fetchLivePrice } from '@/lib/chart-data';
import { liveSourceFor } from '@/lib/use-live-price';
import { marketHref } from '@/lib/solana-links';
import { cashtag, formatPercent, formatSignedCompactUsd } from '@/lib/format';

const K_PATHS = ['M186 140 V372', 'M200 268 L338 140', 'M232 246 L346 372'];

function CoinCard({ m, mine }: { m: DmMessage; mine: boolean }) {
  const t = useTranslations('dm');
  const coin = m.coin!;
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    const source = liveSourceFor(coin);
    if (!source) return;
    let cancelled = false;
    fetchLivePrice(source)
      .then((live) => !cancelled && live && setPrice(live.priceUsd))
      .catch(() => undefined);
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
    <div className="relative w-64 overflow-hidden rounded-3xl border border-white/10 p-4" style={{ background: 'linear-gradient(165deg,#141B4D 0%,#0A0E26 45%,#05070A 100%)' }}>
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
}: {
  m: DmMessage;
  mine: boolean;
  me: string | null;
  first: boolean;
  last: boolean;
  onReact: (messageId: string, emoji: string) => void;
}) {
  const t = useTranslations('dm');
  const [picking, setPicking] = useState(false);
  const reactions = Object.entries(m.reactions).filter(([, who]) => who.length > 0);
  const bait = !mine && m.kind === 'text' && looksLikeScamBait(m.body);

  return (
    <div className={cn('kamby-chat-in flex flex-col', mine ? 'items-end' : 'items-start', first ? 'mt-3' : 'mt-0.5')}>
      {picking && (
        <div className="kamby-glass-solid mb-1 flex gap-1 rounded-full px-2 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)]" role="menu">
          {DM_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onReact(m.id, e);
                setPicking(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 active:scale-90"
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setPicking((p) => !p)} className="max-w-[80%] text-left" aria-label={t('react')}>
        {m.kind === 'text' ? (
          <span
            className={cn(
              'block whitespace-pre-wrap break-words px-4 py-2.5 font-body text-[0.95rem] leading-snug',
              mine
                ? cn('bg-accent text-black', 'rounded-3xl', !first && 'rounded-tr-lg', !last && 'rounded-br-lg')
                : cn('kamby-glass text-ink-900', 'rounded-3xl', !first && 'rounded-tl-lg', !last && 'rounded-bl-lg'),
            )}
          >
            {m.body}
          </span>
        ) : m.kind === 'coin' && m.coin ? (
          <CoinCard m={m} mine={mine} />
        ) : m.kind === 'pnl' && m.pnl ? (
          <PnlCard m={m} />
        ) : m.kind === 'usdc' && m.usdc ? (
          <UsdcCard m={m} mine={mine} />
        ) : null}
      </button>
      {reactions.length > 0 && (
        <div className={cn('-mt-1.5 flex gap-1', mine ? 'mr-2' : 'ml-2')}>
          {reactions.map(([emoji, who]) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(m.id, emoji)}
              className={cn(
                'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs shadow-[0_4px_12px_rgba(0,0,0,0.4)]',
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
