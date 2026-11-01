'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { FeedMarket, MarketFeedSnapshot } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { PriceText } from '@/components/market/PriceText';
import { Sparkline } from '@/components/market/Sparkline';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { QuickBuyButton, QuickBuyProvider } from '@/components/trading/QuickBuy';
import { useMarketFeeds } from '@/lib/market-feeds';
import { cashtag, formatCompactUsd, formatPercent } from '@/lib/format';
import { marketHref, solanaMarketHref } from '@/lib/solana-links';

type Sort = 'volume' | 'mcap' | 'change' | 'liquidity';
const CHAINS = [
  { id: 'all', label: 'All' },
  { id: 'solana', label: 'Solana' },
  { id: 'eip155:8453', label: 'Base' },
  { id: 'eip155:56', label: 'BNB' },
  { id: 'eip155:4663', label: 'Robinhood' },
] as const;

const KEY: Record<Sort, (m: FeedMarket) => number> = {
  volume: (m) => m.volume24hUsd ?? -1,
  mcap: (m) => m.marketCapUsd ?? -1,
  change: (m) => m.priceChange24hPct ?? -Infinity,
  liquidity: (m) => m.liquidityUsd ?? -1,
};

function hrefOf(m: FeedMarket): string | null {
  return m.chainIdentifier === 'solana' ? solanaMarketHref(m.tokenAddress) : marketHref(m.chainIdentifier, m.tokenAddress);
}

/**
 * Trending as one full table (2026-11-01, owner: "look more like GMGN"): every chain's trending
 * coins live from the market stream, sortable by volume, market cap, 24h move or liquidity, with
 * ⚡ quick buy on each row. Phones get the same rows, narrower.
 */
export function TrendingTable({ initial }: { initial: MarketFeedSnapshot }) {
  const t = useTranslations('trendingPage');
  const tCols = useTranslations('coinCols');
  const { feeds } = useMarketFeeds(initial);
  const [chain, setChain] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('volume');

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return feeds.trending.markets
      .filter((m) => {
        const k = `${m.chainIdentifier}:${m.tokenAddress}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return chain === 'all' || m.chainIdentifier === chain;
      })
      .sort((a, b) => KEY[sort](b) - KEY[sort](a));
  }, [feeds.trending.markets, chain, sort]);

  const head = (id: Sort, label: string, className?: string) => (
    <button
      type="button"
      onClick={() => setSort(id)}
      className={cn('text-right font-mono text-[0.62rem] uppercase tracking-wider transition-colors', sort === id ? 'text-accent' : 'text-ink-400 hover:text-ink-600', className)}
    >
      {label}
      {sort === id && ' ↓'}
    </button>
  );

  return (
    <QuickBuyProvider>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-0">
        {CHAINS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setChain(c.id)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full px-3 font-display text-xs font-bold transition-colors',
              chain === c.id ? 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/30' : 'bg-white/[0.04] text-ink-600 hover:text-ink-900',
            )}
          >
            {c.id !== 'all' && badgeChainFor(c.id) && <ChainBadge chain={badgeChainFor(c.id)!} className="!static !h-3.5 !w-3.5 !ring-0" />}
            {c.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[0.68rem] text-ink-400">{t('count', { n: rows.length })}</span>
      </div>

      <div className="overflow-hidden border-y border-white/[0.06] md:rounded-2xl md:border">
        <div className="hidden grid-cols-[2.5rem_minmax(14rem,1.6fr)_repeat(5,minmax(6rem,1fr))_5rem_5.5rem] items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 md:grid">
          <span className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-400">#</span>
          <span className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-400">{tCols('coin')}</span>
          <span className="text-right font-mono text-[0.62rem] uppercase tracking-wider text-ink-400">{tCols('price')}</span>
          {head('change', '24h')}
          {head('mcap', 'MC')}
          {head('liquidity', tCols('liq'))}
          {head('volume', tCols('vol'))}
          <span />
          <span />
        </div>
        {rows.length === 0 && <p className="px-4 py-12 text-center font-body text-sm text-ink-400">{t('empty')}</p>}
        <ul>
          {rows.map((m, i) => {
            const href = hrefOf(m);
            const chainBadge = badgeChainFor(m.chainIdentifier);
            const up = (m.priceChange24hPct ?? 0) >= 0;
            const coin = (
              <span className="flex min-w-0 items-center gap-3">
                <span className="relative shrink-0">
                  <TokenAvatar src={m.logoUrl} seed={m.tokenAddress} label={m.symbol} className="h-10 w-10 text-sm" />
                  {chainBadge && <ChainBadge chain={chainBadge} />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-display text-[0.95rem] font-bold text-ink-900">{cashtag(m.symbol ?? m.tokenAddress.slice(0, 6))}</span>
                    {m.listing === 'new' && <span className="rounded bg-accent/10 px-1 font-mono text-[0.55rem] font-bold uppercase text-accent">new</span>}
                  </span>
                  <span className="block truncate font-body text-xs text-ink-400">{m.name ?? ''}</span>
                </span>
              </span>
            );
            return (
              <li key={`${m.chainIdentifier}:${m.tokenAddress}`} className="border-b border-white/[0.04] last:border-0">
                {/* Computers: the full GMGN-style row. */}
                <div className="hidden grid-cols-[2.5rem_minmax(14rem,1.6fr)_repeat(5,minmax(6rem,1fr))_5rem_5.5rem] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025] md:grid">
                  <span className="font-mono text-xs text-ink-400">{i + 1}</span>
                  {href ? <Link href={href} className="min-w-0">{coin}</Link> : coin}
                  <span className="text-right font-mono text-sm font-semibold tabular-nums text-ink-900"><PriceText value={m.priceUsd} flash /></span>
                  <span className={cn('text-right font-mono text-sm font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(m.priceChange24hPct)}</span>
                  <span className="text-right font-mono text-sm tabular-nums text-ink-900">{formatCompactUsd(m.marketCapUsd)}</span>
                  <span className="text-right font-mono text-sm tabular-nums text-ink-600">{formatCompactUsd(m.liquidityUsd)}</span>
                  <span className="text-right font-mono text-sm tabular-nums text-ink-600">{formatCompactUsd(m.volume24hUsd)}</span>
                  <span className="flex justify-end">{m.recentCloses && <Sparkline closes={m.recentCloses} width={64} height={24} />}</span>
                  <span className="flex justify-end">
                    <QuickBuyButton chainIdentifier={m.chainIdentifier} address={m.tokenAddress} label={cashtag(m.symbol ?? m.tokenAddress.slice(0, 6))} />
                  </span>
                </div>
                {/* Phones: coin, market cap and move, ⚡ on the right. */}
                <div className="flex items-center gap-3 px-4 py-3 md:hidden">
                  {href ? <Link href={href} className="min-w-0 flex-1">{coin}</Link> : <span className="min-w-0 flex-1">{coin}</span>}
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="font-mono text-sm font-semibold tabular-nums text-ink-900">{formatCompactUsd(m.marketCapUsd)}</span>
                    <span className={cn('font-mono text-xs font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(m.priceChange24hPct)}</span>
                  </span>
                  <QuickBuyButton chainIdentifier={m.chainIdentifier} address={m.tokenAddress} label={cashtag(m.symbol ?? m.tokenAddress.slice(0, 6))} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </QuickBuyProvider>
  );
}
