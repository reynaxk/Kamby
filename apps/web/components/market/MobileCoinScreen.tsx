'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { TokenAvatar } from './TokenAvatar';
import { badgeChainFor, ChainBadge } from './ChainBadge';
import { LaunchpadBadge } from './LaunchpadBadge';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { useLivePrice, useTokenStats } from '@/lib/use-live-price';
import { formatCompactUsd, formatPercent, formatPrice } from '@/lib/format';
import type { ChartSource } from '@/lib/chart-data';

export interface MobileCoinTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * A coin's page as a phone app screen (2026-10-10, owner: "it's like a web copy, it's gotta be
 * like fomo"): a small top bar (back · coin · watch · share) instead of the site header, the
 * price big, the chart edge to edge with no card around it, the details behind tabs, and one
 * big Buy (plus Sell) at the bottom that opens the trade panel as a sheet. Phones only — the
 * pages render their desktop layout from `md` up.
 */
export function MobileCoinScreen({
  symbol,
  name,
  logoUrl,
  chainIdentifier,
  address,
  source,
  initialPrice,
  initialChange24hPct,
  initialMarketCapUsd,
  watch,
  banner,
  chart,
  tabs,
  canTrade,
  renderTrade,
}: {
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  chainIdentifier: string;
  address: string;
  source: ChartSource;
  initialPrice: number | null;
  initialChange24hPct: number | null;
  initialMarketCapUsd: number | null;
  watch?: ReactNode;
  banner?: ReactNode;
  chart: ReactNode;
  tabs: MobileCoinTab[];
  canTrade: boolean;
  renderTrade: (side: 'BUY' | 'SELL') => ReactNode;
}) {
  const router = useRouter();
  const tT = useTranslations('terminal');
  const tU = useTranslations('ui');
  const live = useLivePrice(source);
  const stats = useTokenStats(source);
  const [tab, setTab] = useState(tabs[0]?.id ?? '');
  const [side, setSide] = useState<'BUY' | 'SELL' | null>(null);

  const price = live ?? initialPrice;
  const change = stats?.priceChangePct.h24 ?? initialChange24hPct;
  // Market cap moves with the price (same supply) — scaled from the listing's own figure.
  const marketCap = initialMarketCapUsd !== null && initialPrice && price ? (initialMarketCapUsd * price) / initialPrice : initialMarketCapUsd;
  const up = (change ?? 0) >= 0;
  const chain = badgeChainFor(chainIdentifier);
  const label = symbol ?? name ?? address.slice(0, 6);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: `$${label} on Kamby`, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      // Cancelled — nothing to do.
    }
  }

  return (
    <div className="min-h-screen bg-bg pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-40 flex items-center gap-2 bg-bg/90 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl">
        <button
          type="button"
          aria-label={tU('back_0557')}
          onClick={() => (window.history.length > 1 ? router.back() : router.push('/home'))}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 active:bg-white/10"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="relative shrink-0">
          <TokenAvatar src={logoUrl} seed={address} label={label} className="h-9 w-9 text-sm" />
          {chain && <ChainBadge chain={chain} />}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1 truncate font-display text-[0.95rem] font-bold text-ink-900">
            {label}
            <LaunchpadBadge chain={chainIdentifier} address={address} />
          </span>
          <span className="block truncate font-body text-xs text-ink-400">{name ?? ''}</span>
        </span>
        {watch}
        <button
          type="button"
          aria-label={tU('share_5a95')}
          onClick={() => void share()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 active:bg-white/10"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v13M7 8l5-5 5 5" />
            <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          </svg>
        </button>
      </header>

      <div className="flex items-start justify-between gap-3 px-4 pt-1">
        <div className="min-w-0">
          <p className="truncate font-display text-[2rem] font-bold leading-none tracking-tight text-ink-900 tabular-nums">{formatPrice(price)}</p>
          {change !== null && (
            <p className={cn('mt-1.5 font-body text-sm font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>
              {up ? '▲' : '▼'} {formatPercent(change).replace(/^[+-]/, '')} <span className="font-medium text-ink-400">24h</span>
            </p>
          )}
        </div>
        {marketCap !== null && (
          <div className="shrink-0 text-right">
            <p className="font-display text-base font-bold text-ink-900 tabular-nums">{formatCompactUsd(marketCap)}</p>
            <p className="font-body text-xs text-ink-400">{tU('marketCap_af63')}</p>
          </div>
        )}
      </div>

      {banner && <div className="px-4 pt-3">{banner}</div>}

      <div className="mt-3 h-[330px]">{chart}</div>

      {tabs.length > 0 && (
        <>
          <div role="tablist" className="mt-4 flex border-b border-white/10 px-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative flex-1 py-3 font-display text-sm font-semibold transition-colors',
                  tab === t.id ? 'text-ink-900' : 'text-ink-400',
                )}
              >
                {t.label}
                {tab === t.id && <span aria-hidden className="absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
          {tabs.map((t) => (
            <div key={t.id} role="tabpanel" hidden={tab !== t.id} className="kamby-app-panel">
              {t.content}
            </div>
          ))}
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 bg-gradient-to-t from-bg via-bg/95 to-bg/0 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-6">
        <button
          type="button"
          disabled={!canTrade}
          onClick={() => setSide('BUY')}
          className="h-14 flex-[2] rounded-2xl bg-up font-display text-base font-bold text-black shadow-[0_8px_24px_rgba(34,197,94,0.35)] transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {tT('buy')}
        </button>
        <button
          type="button"
          disabled={!canTrade}
          onClick={() => setSide('SELL')}
          className="h-14 flex-1 rounded-2xl border border-white/10 bg-surface-raised font-display text-base font-bold text-ink-900 transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {tT('sell')}
        </button>
      </div>

      <MobileDrawer open={side !== null} onClose={() => setSide(null)} title={`${side === 'SELL' ? tT('sell') : tT('buy')} $${label}`}>
        {side && renderTrade(side)}
      </MobileDrawer>
    </div>
  );
}
