'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { TokenAvatar } from './TokenAvatar';
import { badgeChainFor, ChainBadge } from './ChainBadge';
import { LaunchpadBadge } from './LaunchpadBadge';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { PriceText } from './PriceText';
import { PositionChip } from '@/components/trading/PositionChip';
import { QuickBuyButton, QuickBuyProvider } from '@/components/trading/QuickBuy';
import { useLivePrice, useTokenStats } from '@/lib/use-live-price';
import { cashtag, formatCompactUsd, formatPercent } from '@/lib/format';
import type { ChartSource } from '@/lib/chart-data';
import { saveRecentSearch } from '@/lib/recent-searches';

export interface MobileCoinTab {
  id: string;
  label: string;
  /** A small grey count after the label (e.g. holders). */
  badge?: string;
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
  const tC = useTranslations('coin');
  const live = useLivePrice(source);
  const stats = useTokenStats(source);
  const [tab, setTab] = useState(tabs[0]?.id ?? '');
  // A tab mounts the first time it's opened, then stays (no refetch when switching back).
  const [opened, setOpened] = useState<Set<string>>(() => new Set([tabs[0]?.id ?? '']));
  const [side, setSide] = useState<'BUY' | 'SELL' | null>(null);
  // ⚡ on a list row opens a coin straight on its buy keypad (?buy=1, 2026-10-29); "Sell" on a
  // holding opens it on the sell sheet (?sell=1).
  useEffect(() => {
    if (!canTrade) return;
    const url = new URL(window.location.href);
    const open = url.searchParams.get('buy') === '1' ? 'BUY' : url.searchParams.get('sell') === '1' ? 'SELL' : null;
    if (!open) return;
    url.searchParams.delete('buy');
    url.searchParams.delete('sell');
    window.history.replaceState(window.history.state, '', url.toString());
    setSide(open);
  }, [canTrade]);
  // Once the big price scrolls away it rides along in the top bar instead (2026-10-10).
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 70);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const price = live ?? initialPrice;
  const change = stats?.priceChangePct.h24 ?? initialChange24hPct;
  // Market cap moves with the price (same supply) — scaled from the listing's own figure.
  const marketCap = initialMarketCapUsd !== null && initialPrice && price ? (initialMarketCapUsd * price) / initialPrice : initialMarketCapUsd;
  const up = (change ?? 0) >= 0;
  const chain = badgeChainFor(chainIdentifier);

  // Every coin you open goes into Search's history, with the price you saw (2026-10-16) —
  // once per visit, as soon as there's a price.
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (price === null || recorded.current === address) return;
    recorded.current = address;
    saveRecentSearch({ chainIdentifier, tokenAddress: address, symbol, name, logoUrl, priceUsd: price });
  }, [address, price, chainIdentifier, symbol, name, logoUrl]);
  const label = symbol ?? name ?? address.slice(0, 6);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: `${cashtag(label)} on Kamby`, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      // Cancelled — nothing to do.
    }
  }

  return (
    <div className="min-h-screen bg-bg pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="kamby-frost-bar-phone sticky top-0 z-40 flex items-center gap-2 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
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
          {scrolled ? (
            <span className={cn('block font-body text-xs font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>
              <PriceText value={price} flash /> {change !== null && formatPercent(change)}
            </span>
          ) : (
            <span className="block truncate font-body text-xs text-ink-400">{name ?? ''}</span>
          )}
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
          <p className="truncate font-display text-[2rem] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
            <PriceText value={price} flash />
          </p>
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

      {/* The coin at a glance (2026-10-28, GMGN-like but calmer): the move over four windows, then
          liquidity, 24h volume, age and trades — one quiet row each, no boxes. */}
      {stats && (
        <>
          <div className="mt-3 grid grid-cols-4 gap-1.5 px-4">
            {(['m5', 'h1', 'h6', 'h24'] as const).map((w) => {
              const v = stats.priceChangePct[w];
              return (
                <span key={w} className={cn('rounded-xl py-1.5 text-center', v === null ? 'bg-white/[0.03]' : v >= 0 ? 'bg-up/[0.08]' : 'bg-down/[0.08]')}>
                  <span className="block font-body text-[0.62rem] font-semibold uppercase text-ink-400">{w.replace('m', '').replace('h', '') + (w.startsWith('m') ? 'm' : 'h')}</span>
                  <span className={cn('block font-display text-[0.8rem] font-bold tabular-nums', v === null ? 'text-ink-400' : v >= 0 ? 'text-up' : 'text-down')}>
                    {v === null ? '—' : formatPercent(v)}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="mt-2.5 grid grid-cols-4 gap-1 px-4">
            <Fact label={tC('liq')} value={stats.liquidityUsd != null ? formatCompactUsd(stats.liquidityUsd) : '—'} />
            <Fact label={tC('vol24')} value={formatCompactUsd(stats.volumeUsd.h24)} />
            <Fact label={tC('age')} value={stats.pairCreatedAtMs ? ageShort(Date.now() - stats.pairCreatedAtMs) : '—'} />
            <Fact
              label={tC('txns')}
              value={
                <>
                  <span className="text-up">{compactCount(stats.txns24h.buys)}</span>
                  <span className="text-ink-400">/</span>
                  <span className="text-down">{compactCount(stats.txns24h.sells)}</span>
                </>
              }
            />
          </div>
        </>
      )}

      {/* What you hold of it, right under the price — trading apps lead with your position. */}
      <div className="px-4 pt-2 empty:hidden">
        <PositionChip source={source} />
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
                onClick={() => {
                  setTab(t.id);
                  setOpened((prev) => (prev.has(t.id) ? prev : new Set(prev).add(t.id)));
                }}
                className={cn(
                  'relative flex-1 whitespace-nowrap py-3 font-display text-sm font-semibold transition-colors',
                  tab === t.id ? 'text-ink-900' : 'text-ink-400',
                )}
              >
                {t.label}
                {t.badge && <span className="ml-1 font-body text-[0.7rem] font-medium text-ink-400">{t.badge}</span>}
                {tab === t.id && <span aria-hidden className="absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
          {tabs.map((t) => (
            <div key={t.id} role="tabpanel" hidden={tab !== t.id} className="kamby-app-panel">
              {opened.has(t.id) && t.content}
            </div>
          ))}
        </>
      )}

      {/* Buy / Sell float in a frosted capsule, like the tab bar on the other screens (2026-10-16). */}
      <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 flex gap-1.5 rounded-[1.4rem] p-1.5 kamby-glass-solid kamby-glass-dense shadow-[0_10px_36px_rgba(0,0,0,0.6)]">
        <button
          type="button"
          disabled={!canTrade}
          onClick={() => setSide('BUY')}
          className="h-12 flex-[2] rounded-2xl bg-accent font-display text-base font-bold text-black transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {tT('buy')}
        </button>
        {/* ⚡ the set amount in one tap (2026-10-29, GMGN's quick amounts): Solana buys right away,
            other chains open the buy sheet already on that amount. */}
        {canTrade && (
          <QuickBuyProvider>
            <QuickBuyButton chainIdentifier={chainIdentifier} address={address} label={cashtag(label)} onOpen={() => setSide('BUY')} className="!h-12 rounded-2xl px-3.5 text-base" />
          </QuickBuyProvider>
        )}
        <button
          type="button"
          disabled={!canTrade}
          onClick={() => setSide('SELL')}
          className="h-12 flex-1 rounded-2xl border border-down/30 bg-down/[0.08] font-display text-base font-bold text-down transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {tT('sell')}
        </button>
      </div>

      <MobileDrawer open={side !== null} onClose={() => setSide(null)} title={`${side === 'SELL' ? tT('sell') : tT('buy')} ${cashtag(label)}`}>
        {side && renderTrade(side)}
      </MobileDrawer>
    </div>
  );
}



function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="min-w-0">
      <span className="block truncate font-body text-[0.65rem] font-semibold text-ink-400">{label}</span>
      <span className="block truncate font-display text-sm font-bold tabular-nums text-ink-900">{value}</span>
    </span>
  );
}

function ageShort(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 525_600) return `${Math.floor(m / 1440)}d`;
  return `${Math.floor(m / 525_600)}y`;
}

function compactCount(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
