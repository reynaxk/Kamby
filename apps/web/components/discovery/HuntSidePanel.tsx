'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { FeedMarket } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { PulseChat } from '@/components/pulse/PulseChat';
import { TrackFeed } from '@/components/track/TrackFeed';
import { cashtag, formatCompactCount, formatPercent, formatPrice } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';

type Tab = 'track' | 'chat' | 'trending';
const TAB_KEY = 'kamby:hunt-dock';

/**
 * Hunt's right-hand dock on wide screens (Kamby Prime, 2026-11-04 — was a left panel from
 * the 11-02 canvas): whale and followed-trader trades live, the Pulse chat, or the trending
 * list — one at a time, the last one you picked remembered.
 */
export function HuntSidePanel({ trending }: { trending: FeedMarket[] }) {
  const t = useTranslations('huntSide');
  const tT = useTranslations('track');
  const [tab, setTab] = useState<Tab>('track');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved === 'track' || saved === 'chat' || saved === 'trending') setTab(saved);
    } catch {
      // private mode — starts on Track
    }
  }, []);
  const pick = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // private mode — still switches
    }
  };
  const labels: Record<Tab, string> = { track: tT('tab'), chat: t('pulse'), trending: t('trending') };

  return (
    <aside className="sticky top-[calc(var(--top-h,48px)+0.75rem)] hidden h-[calc(100dvh-var(--top-h,48px)-var(--ticker-h,0px)-6.5rem)] min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-[#0A0B0E] xl:flex">
      <div role="tablist" className="flex h-10 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
        {(['track', 'chat', 'trending'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => pick(id)}
            className={cn('h-7 rounded-md px-2.5 text-[0.78rem] font-medium transition-colors', tab === id ? 'bg-surface-raised text-ink-900' : 'text-ink-600 hover:text-ink-900')}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      <div className="kamby-thin-scroll min-h-0 flex-1 overflow-y-auto">
        {tab === 'track' && <TrackFeed dock />}
        {tab === 'chat' && <PulseChat className="h-full [&_p]:text-[0.75rem]" />}
        {tab === 'trending' && (
          <ul className="py-1">
            {trending.slice(0, 20).map((m) => {
              const href = marketHref(m.chainIdentifier, m.tokenAddress);
              const pct = m.windows?.change1hPct ?? m.priceChange24hPct;
              const tx = (m.windows?.buys24h ?? 0) + (m.windows?.sells24h ?? 0);
              const body = (
                <>
                  <TokenAvatar src={m.logoUrl} seed={m.tokenAddress} label={m.symbol} className="!rounded-md h-8 w-8 text-[0.6rem]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8rem] font-semibold text-ink-900">{cashtag(m.symbol ?? m.tokenAddress.slice(0, 5))}</span>
                    {tx > 0 && <span className="block font-mono text-[0.64rem] text-ink-400">{formatCompactCount(tx)} tx</span>}
                  </span>
                  <span className="text-right font-mono tabular-nums">
                    <span className="block text-[0.72rem] text-ink-900">{formatPrice(m.priceUsd)}</span>
                    {pct != null && <span className={cn('block text-[0.66rem]', pct >= 0 ? 'text-up' : 'text-down')}>{formatPercent(pct)}</span>}
                  </span>
                </>
              );
              return (
                <li key={`${m.chainIdentifier}:${m.tokenAddress}`}>
                  {href ? (
                    <Link href={href} className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.03]">
                      {body}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-2.5 px-3 py-2">{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
