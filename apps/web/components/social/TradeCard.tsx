'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DmTrade } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { PriceText } from '@/components/market/PriceText';
import { liveSourceFor, useLivePrice } from '@/lib/use-live-price';
import { cashtag, formatCompactUsd, formatPercent } from '@/lib/format';
import { CopySnipeSheet } from './CopySnipeSheet';
import { Bolt } from './Bolt';

/** Only cards on screen follow the live price — a long chat full of cards doesn't poll them all. */
function useOnScreen<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setOn(Boolean(entry?.isIntersecting)), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on];
}

/**
 * A Trade Card (2026-10-17): a buy someone chose to share — coin, chain, their entry, the live
 * price and PnL since — and ⚡ COPY SNIPE, which opens Kamby's own trade sheet for the same coin
 * (amount → price, fee and safety check → Buy). Used in chats, communities and live rooms.
 */
export function TradeCard({ trade, mine = false, by = null, className, compact = false }: { trade: DmTrade; mine?: boolean; by?: string | null; className?: string; compact?: boolean }) {
  const t = useTranslations('snipe');
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const source = useMemo(() => (onScreen ? liveSourceFor(trade) : null), [onScreen, trade]);
  const price = useLivePrice(source);
  const [open, setOpen] = useState(false);
  const pct = price !== null && trade.entryPriceUsd > 0 ? (price / trade.entryPriceUsd - 1) * 100 : null;
  const up = (pct ?? 0) >= 0;
  const chain = badgeChainFor(trade.chainIdentifier);

  // One glass row for a live room's stage (the host's pinned trade).
  if (compact) {
    return (
      <div ref={ref} className={cn('kamby-glass-solid flex items-center gap-2.5 rounded-2xl py-2 pl-2 pr-1.5', className)}>
        <span className="relative shrink-0">
          <TokenAvatar src={trade.logoUrl} seed={trade.tokenAddress} label={trade.symbol ?? trade.tokenAddress} className="h-9 w-9 text-xs" />
          {chain && <ChainBadge chain={chain} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-black text-white">{cashtag(trade.symbol ?? trade.tokenAddress.slice(0, 6))}</span>
          <span className="block truncate font-body text-[0.65rem] text-white/55">
            {t('entry')} <PriceText value={trade.entryPriceUsd} />
          </span>
        </span>
        <span className={cn('shrink-0 font-display text-base font-black tabular-nums', pct === null ? 'text-white/40' : up ? 'text-up' : 'text-down')}>{pct === null ? '—' : formatPercent(pct)}</span>
        {!mine && (
          <button type="button" onClick={() => setOpen(true)} className="flex shrink-0 items-center gap-1 rounded-xl bg-accent px-3 py-2 font-display text-xs font-black text-black transition-transform active:scale-95">
            <Bolt className="h-3.5 w-3.5" />
            {t('copy')}
          </button>
        )}
        {open && <CopySnipeSheet open={open} onClose={() => setOpen(false)} trade={trade} by={by} livePrice={price} />}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn('relative w-[17rem] overflow-hidden rounded-3xl border border-white/10 p-3.5 text-left', className)}
      style={{ background: 'linear-gradient(160deg,#101833 0%,#0A0F22 50%,#030305 100%)' }}
    >
      <div className="flex items-start gap-2.5">
        <span className="relative shrink-0">
          <TokenAvatar src={trade.logoUrl} seed={trade.tokenAddress} label={trade.symbol ?? trade.tokenAddress} className="h-10 w-10 text-xs" />
          {chain && <ChainBadge chain={chain} />}
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-display text-base font-black leading-tight text-ink-900">{cashtag(trade.symbol ?? trade.tokenAddress.slice(0, 6))}</span>
            <span className="shrink-0 rounded-full bg-up/15 px-1.5 py-0.5 font-body text-[0.52rem] font-bold uppercase tracking-wider text-up">{t('bought')}</span>
          </span>
          <span className="mt-0.5 block truncate font-body text-[0.66rem] text-ink-400">{by ? t('byTrader', { name: by }) : (trade.name ?? '')}</span>
        </span>
        {/* Live PnL since their entry, big */}
        <span className="shrink-0 text-right">
          <span className={cn('block font-display text-xl font-black leading-none tabular-nums tracking-tight', pct === null ? 'text-ink-400' : up ? 'text-up' : 'text-down')}>
            {pct === null ? '—' : formatPercent(pct)}
          </span>
          <span className="mt-1 block font-body text-[0.55rem] font-semibold uppercase tracking-wider text-ink-400">PnL</span>
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <div className="rounded-2xl bg-white/[0.04] px-3 py-2">
          <p className="font-body text-[0.56rem] font-semibold uppercase tracking-wider text-ink-400">{t('entry')}</p>
          <p className="mt-0.5 truncate font-display text-sm font-bold tabular-nums text-ink-900">
            <PriceText value={trade.entryPriceUsd} />
          </p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] px-3 py-2">
          <p className="flex items-center gap-1 font-body text-[0.56rem] font-semibold uppercase tracking-wider text-ink-400">
            {price !== null && <span className="h-1 w-1 animate-pulse rounded-full bg-up" aria-hidden />}
            {t('now')}
          </p>
          <p className="mt-0.5 truncate font-display text-sm font-bold tabular-nums text-ink-900">
            <PriceText value={price} flash />
          </p>
        </div>
      </div>
      <p className="mt-2 px-0.5 font-body text-[0.64rem] text-ink-400">{t('invested', { amount: formatCompactUsd(trade.investedUsd) })}</p>

      {!mine && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-accent py-2.5 font-display text-sm font-black tracking-wide text-black transition-transform active:scale-[0.97]"
        >
          <Bolt />
          {t('copySnipe')}
        </button>
      )}
      {open && <CopySnipeSheet open={open} onClose={() => setOpen(false)} trade={trade} by={by} livePrice={price} />}
    </div>
  );
}
