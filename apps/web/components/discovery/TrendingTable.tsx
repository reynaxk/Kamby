'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { FeedMarket, MarketFeedSnapshot } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { PriceText } from '@/components/market/PriceText';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { QuickBuyButton, QuickBuyProvider } from '@/components/trading/QuickBuy';
import { useMarketFeeds } from '@/lib/market-feeds';
import { cashtag, formatAge, formatCompactCount, formatCompactUsd, formatPercent } from '@/lib/format';
import { marketHref, solanaMarketHref } from '@/lib/solana-links';

type Window = '5m' | '1h' | '6h' | '24h';
type Sort = 'volume' | 'mcap' | 'change' | 'liquidity' | 'txns' | 'age';
const WINDOWS: Window[] = ['5m', '1h', '6h', '24h'];
const CHAINS = [
  { id: 'all', label: 'All' },
  { id: 'solana', label: 'Solana' },
  { id: 'eip155:8453', label: 'Base' },
  { id: 'eip155:56', label: 'BSC' },
  { id: 'eip155:4663', label: 'Robinhood' },
] as const;

function change(m: FeedMarket, w: Window): number | null {
  if (w === '24h') return m.priceChange24hPct;
  const v = w === '5m' ? m.windows?.change5mPct : w === '1h' ? m.windows?.change1hPct : m.windows?.change6hPct;
  return v ?? null;
}
function volume(m: FeedMarket, w: Window): number | null {
  if (w === '24h') return m.volume24hUsd;
  const v = w === '5m' ? m.windows?.volume5mUsd : w === '1h' ? m.windows?.volume1hUsd : m.windows?.volume6hUsd;
  return v ?? null;
}
const txns = (m: FeedMarket) => (m.windows?.buys24h ?? 0) + (m.windows?.sells24h ?? 0);

function hrefOf(m: FeedMarket): string | null {
  return m.chainIdentifier === 'solana' ? solanaMarketHref(m.tokenAddress) : marketHref(m.chainIdentifier, m.tokenAddress);
}

const GRID = 'grid-cols-[2rem_minmax(13rem,1.7fr)_4.5rem_repeat(4,minmax(5.5rem,1fr))_repeat(4,4.75rem)_5.5rem]';

function Pct({ v, className }: { v: number | null; className?: string }) {
  if (v === null) return <span className={cn('text-right font-mono text-[0.8rem] text-ink-400', className)}>—</span>;
  return <span className={cn('text-right font-mono text-[0.8rem] font-semibold tabular-nums', v >= 0 ? 'text-up' : 'text-down', className)}>{formatPercent(v)}</span>;
}

/**
 * Trending as one full table (2026-11-01, owner: "look more like GMGN"): every chain's trending
 * coins live from the market stream. The 5m / 1h / 6h / 24h tabs pick the window for volume and
 * the default sort; all four moves stay visible, with the coin's age, liquidity, market cap and
 * 24h trades (buys / sells) — from the same DexScreener pool as its live price. ⚡ on each row.
 */
export function TrendingTable({ initial, initialSort = 'volume' }: { initial: MarketFeedSnapshot; initialSort?: Sort }) {
  const t = useTranslations('trendingPage');
  const tCols = useTranslations('coinCols');
  const { feeds } = useMarketFeeds(initial);
  const [chain, setChain] = useState<string>('all');
  const [win, setWin] = useState<Window>('1h');
  const [sort, setSort] = useState<Sort>(initialSort);
  // Ages come from the clock — shown once hydrated, so server and browser render the same text.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const key: Record<Sort, (m: FeedMarket) => number> = {
      volume: (m) => volume(m, win) ?? -1,
      mcap: (m) => m.marketCapUsd ?? -1,
      change: (m) => change(m, win) ?? -Infinity,
      liquidity: (m) => m.liquidityUsd ?? -1,
      txns,
      // Newest first; a coin without a known pool age goes last, never first (2026-11-02).
      age: (m) => m.windows?.poolCreatedAtMs ?? -Infinity,
    };
    return feeds.trending.markets
      .filter((m) => {
        const k = `${m.chainIdentifier}:${m.tokenAddress}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return chain === 'all' || m.chainIdentifier === chain;
      })
      .sort((a, b) => {
        const x = key[sort](a), y = key[sort](b);
        return x === y ? 0 : y > x ? 1 : -1;
      });
  }, [feeds.trending.markets, chain, sort, win]);

  const head = (id: Sort | null, label: string, className?: string) =>
    id ? (
      <button
        type="button"
        onClick={() => setSort(id)}
        className={cn('text-right font-mono text-[0.6rem] uppercase tracking-wider transition-colors', sort === id ? 'text-accent' : 'text-ink-400 hover:text-ink-600', className)}
      >
        {label}
        {sort === id && ' ↓'}
      </button>
    ) : (
      <span className={cn('text-right font-mono text-[0.6rem] uppercase tracking-wider text-ink-400', className)}>{label}</span>
    );

  return (
    <QuickBuyProvider>
      {/* Phones: one row that scrolls sideways, not two ragged rows (2026-11-02 polish). */}
      <div className="flex items-center gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] md:flex-wrap md:overflow-visible md:px-0">
        <div className="flex shrink-0 rounded-xl bg-white/[0.04] p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWin(w)}
              className={cn('h-8 rounded-lg px-3 font-mono text-xs font-bold transition-colors', win === w ? 'bg-white/[0.1] text-ink-900' : 'text-ink-400 hover:text-ink-600')}
            >
              {w}
            </button>
          ))}
        </div>
        {CHAINS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setChain(c.id)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-display text-xs font-bold transition-colors',
              chain === c.id ? 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/30' : 'bg-white/[0.04] text-ink-600 hover:text-ink-900',
            )}
          >
            {c.id !== 'all' && badgeChainFor(c.id) && <ChainBadge chain={badgeChainFor(c.id)!} className="!static !h-3.5 !w-3.5 !ring-0" />}
            {c.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[0.68rem] text-ink-400 max-md:hidden">{t('count', { n: rows.length })}</span>
      </div>

      <div className="overflow-x-auto border-y border-white/[0.06] md:rounded-2xl md:border">
        <div className={cn('hidden min-w-[1180px] items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 md:grid', GRID)}>
          <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-400">#</span>
          <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-400">{tCols('coin')}</span>
          {head('age', t('age'))}
          {head('liquidity', tCols('liq'))}
          {head('mcap', 'MC')}
          {head('txns', t('txns'))}
          {head('volume', `Vol ${win}`)}
          {WINDOWS.map((w) => (
            <span key={w} className={cn('text-right font-mono text-[0.6rem] uppercase tracking-wider', w === win ? 'text-ink-900' : 'text-ink-400')}>
              {w}
            </span>
          ))}
          <span />
        </div>
        {rows.length === 0 && <p className="px-4 py-12 text-center font-body text-sm text-ink-400">{t('empty')}</p>}
        <ul className="md:min-w-[1180px]">
          {rows.map((m, i) => {
            const href = hrefOf(m);
            const chainBadge = badgeChainFor(m.chainIdentifier);
            const created = m.windows?.poolCreatedAtMs;
            const age = created && mounted ? formatAge(new Date(created).toISOString()) : null;
            const label = cashtag(m.symbol ?? m.tokenAddress.slice(0, 6));
            const coin = (
              <span className="flex min-w-0 items-center gap-3">
                <span className="relative shrink-0">
                  <TokenAvatar src={m.logoUrl} seed={m.tokenAddress} label={m.symbol} className="h-12 w-12 rounded-xl text-base" />
                  {chainBadge && <ChainBadge chain={chainBadge} />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-display text-[0.95rem] font-bold text-ink-900">{label}</span>
                    {m.listing === 'new' && <span className="rounded bg-accent/10 px-1 font-mono text-[0.55rem] font-bold uppercase text-accent">new</span>}
                  </span>
                  <span className="flex items-center gap-1.5 font-body text-xs text-ink-400">
                    <span className="truncate">{m.name ?? ''}</span>
                    <span className="shrink-0 font-mono text-[0.7rem] text-ink-600 md:hidden">{age}</span>
                  </span>
                  <span className="hidden font-mono text-[0.7rem] tabular-nums text-ink-600 md:block">
                    <PriceText value={m.priceUsd} flash />
                  </span>
                </span>
              </span>
            );
            const buys = m.windows?.buys24h;
            const sells = m.windows?.sells24h;
            return (
              <li key={`${m.chainIdentifier}:${m.tokenAddress}`} className="border-b border-white/[0.04] last:border-0">
                {/* Computers: the full GMGN-style row. */}
                <div className={cn('hidden items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025] md:grid', GRID)}>
                  <span className="font-mono text-xs text-ink-400">{i + 1}</span>
                  {href ? <Link href={href} className="min-w-0">{coin}</Link> : coin}
                  <span className="text-right font-mono text-[0.8rem] text-ink-600">{age ?? '—'}</span>
                  <span className="text-right font-mono text-[0.85rem] tabular-nums text-ink-600">{formatCompactUsd(m.liquidityUsd)}</span>
                  <span className="text-right font-mono text-[0.85rem] font-semibold tabular-nums text-ink-900">{formatCompactUsd(m.marketCapUsd)}</span>
                  <span className="text-right font-mono text-[0.8rem] tabular-nums">
                    {buys !== undefined || sells !== undefined ? (
                      <>
                        <span className="block text-ink-900">{formatCompactCount(txns(m))}</span>
                        <span className="text-up">{formatCompactCount(buys ?? 0)}</span>
                        <span className="text-ink-400">/</span>
                        <span className="text-down">{formatCompactCount(sells ?? 0)}</span>
                      </>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </span>
                  <span className="text-right font-mono text-[0.85rem] tabular-nums text-ink-900">{formatCompactUsd(volume(m, win))}</span>
                  {WINDOWS.map((w) => (
                    <Pct key={w} v={change(m, w)} className={w === win ? 'rounded-md bg-white/[0.03] px-1 py-0.5' : undefined} />
                  ))}
                  <span className="flex justify-end">
                    <QuickBuyButton chainIdentifier={m.chainIdentifier} address={m.tokenAddress} label={label} />
                  </span>
                </div>
                {/* Phones: coin and age, market cap and the chosen window's move, ⚡ on the right. */}
                <div className="flex items-center gap-3 px-4 py-3 md:hidden">
                  {href ? <Link href={href} className="min-w-0 flex-1">{coin}</Link> : <span className="min-w-0 flex-1">{coin}</span>}
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="font-mono text-sm font-semibold tabular-nums text-ink-900">{formatCompactUsd(m.marketCapUsd)}</span>
                    <Pct v={change(m, win)} className="text-xs" />
                  </span>
                  <QuickBuyButton chainIdentifier={m.chainIdentifier} address={m.tokenAddress} label={label} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </QuickBuyProvider>
  );
}
