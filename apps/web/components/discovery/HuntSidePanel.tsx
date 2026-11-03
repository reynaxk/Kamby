'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { FeedMarket } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { PulseChat } from '@/components/pulse/PulseChat';
import { cashtag, formatCompactCount, formatPercent, formatPrice } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';

/**
 * Hunt's left panel on wide screens (2026-11-02, owner approved the dense terminal canvas):
 * the trending coins at a glance, then the worldwide Pulse chat. Each section folds away.
 */
export function HuntSidePanel({ trending }: { trending: FeedMarket[] }) {
  const t = useTranslations('huntSide');
  const [openTrend, setOpenTrend] = useState(true);
  const [openChat, setOpenChat] = useState(true);
  const rows = trending.slice(0, 10);
  return (
    <aside className="sticky top-[calc(var(--top-h,56px)+0.5rem)] hidden h-[calc(100dvh-var(--top-h,56px)-var(--ticker-h,0px)-1.5rem)] min-h-0 w-[230px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#08090C] xl:flex">
      <button type="button" onClick={() => setOpenTrend((o) => !o)} aria-expanded={openTrend} className="flex h-8 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3 text-left font-display text-[0.75rem] font-bold text-ink-900">
        {t('trending')}
        <span className={cn('ml-auto text-[0.6rem] text-ink-400 transition-transform', !openTrend && '-rotate-90')} aria-hidden>
          ▼
        </span>
      </button>
      {openTrend && (
        <ul className="kamby-thin-scroll max-h-[46%] shrink-0 overflow-y-auto py-1">
          {rows.map((m) => {
            const href = marketHref(m.chainIdentifier, m.tokenAddress);
            const pct = m.windows?.change1hPct ?? m.priceChange24hPct;
            const tx = (m.windows?.buys24h ?? 0) + (m.windows?.sells24h ?? 0);
            const body = (
              <>
                <TokenAvatar src={m.logoUrl} seed={m.tokenAddress} label={m.symbol} className="h-6 w-6 text-[0.55rem]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[0.72rem] font-bold text-ink-900">{cashtag(m.symbol ?? m.tokenAddress.slice(0, 5))}</span>
                  {tx > 0 && <span className="block font-mono text-[0.58rem] text-ink-400">{formatCompactCount(tx)} tx</span>}
                </span>
                <span className="text-right font-mono">
                  <span className="block text-[0.62rem] text-ink-900">{formatPrice(m.priceUsd)}</span>
                  {pct != null && <span className={cn('block text-[0.58rem]', pct >= 0 ? 'text-up' : 'text-down')}>{formatPercent(pct)}</span>}
                </span>
              </>
            );
            return (
              <li key={`${m.chainIdentifier}:${m.tokenAddress}`}>
                {href ? (
                  <Link href={href} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.03]">
                    {body}
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 px-3 py-1.5">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={() => setOpenChat((o) => !o)} aria-expanded={openChat} className="flex h-8 shrink-0 items-center gap-2 border-y border-white/[0.07] px-3 text-left font-display text-[0.75rem] font-bold text-ink-900">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
        {t('pulse')}
        <span className={cn('ml-auto text-[0.6rem] text-ink-400 transition-transform', !openChat && '-rotate-90')} aria-hidden>
          ▼
        </span>
      </button>
      {openChat && <PulseChat className="min-h-0 flex-1 [&_p]:text-[0.72rem]" />}
    </aside>
  );
}
