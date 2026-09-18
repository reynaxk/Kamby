'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DEFAULT_CHAIN_SLUG, type MarketSummary, type PumpFunTokenSummary, slugForIdentifier } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatCompactUsd, formatPercent, formatRelativeTime, truncateAddress } from '@/lib/format';
import { fetchTrenches, isPumpFunCategory, type TrenchesCategory } from '@/lib/trenches-client';

const TABS: { category: TrenchesCategory; label: string }[] = [
  { category: 'FRESH', label: 'Fresh' },
  { category: 'NEAR_GRADUATED', label: 'Near Grad' },
  { category: 'JUST_GRADUATED', label: 'Graduated' },
  { category: 'TRENDING_HOLDERS', label: 'Trending' },
];

function lamportsToSol(raw: string): number {
  return Number(raw) / 1_000_000_000;
}

/**
 * Real trench category browsing — see docs/TRADING.md#pump-fun-trenches. Replaces the
 * terminal's previous mock trending-tokens list (see git history) with genuinely live data
 * across all four categories: FRESH/NEAR_GRADUATED/JUST_GRADUATED read Pump.fun bonding-
 * curve state (apps/workers/src/pumpfun/pumpfun-ingestion.ts), TRENDING_HOLDERS reads
 * Kamby's existing EVM market data.
 *
 * Deliberately no click-to-trade action on the Pump.fun categories: Solana trading is
 * currently fixed to SOL only (see app/solana/page.tsx) — there is no real per-token
 * Solana trading route yet to send a tap to, and pretending there is would be worse than
 * an inert row. TRENDING_HOLDERS rows link to the real, existing /market/[address] page.
 */
export function TrenchesPanel() {
  const [category, setCategory] = useState<TrenchesCategory>('FRESH');
  const [items, setItems] = useState<MarketSummary[] | PumpFunTokenSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetchTrenches(category)
      .then((result) => {
        if (cancelled) return;
        setItems(result);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex border-b border-line">
        {TABS.map((tab) => (
          <button
            key={tab.category}
            type="button"
            onClick={() => setCategory(tab.category)}
            className={cn(
              'flex-1 border-b-2 px-2 py-2.5 font-display text-[0.65rem] font-bold uppercase tracking-wide transition-colors',
              category === tab.category ? 'border-accent text-ink-900' : 'border-transparent text-ink-400 hover:text-ink-600',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {status === 'loading' && <p className="p-3 font-body text-xs text-ink-400">Loading…</p>}
        {status === 'error' && <p className="p-3 font-body text-xs text-down">Couldn&apos;t load this trench.</p>}
        {status === 'ready' && items.length === 0 && (
          <p className="p-3 font-body text-xs text-ink-400">No tokens in this trench right now.</p>
        )}
        {status === 'ready' &&
          (isPumpFunCategory(category)
            ? (items as PumpFunTokenSummary[]).map((token) => <PumpFunRow key={token.mintAddress} token={token} />)
            : (items as MarketSummary[]).map((market) => <TrendingHolderRow key={market.tokenAddress} market={market} />))}
      </div>
    </div>
  );
}

function PumpFunRow({ token }: { token: PumpFunTokenSummary }) {
  const solRaised = lamportsToSol(token.realSolReserves);
  return (
    <div className="flex items-center gap-2.5 border-b border-line/60 px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised font-display text-xs font-bold text-ink-600">
        {(token.symbol ?? token.mintAddress).slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-semibold text-ink-900">
          {token.symbol ? `$${token.symbol}` : truncateAddress(token.mintAddress)}
        </span>
        <span className="block truncate font-mono text-[0.65rem] text-ink-400">
          {token.complete ? `Graduated ${token.graduatedAt ? formatRelativeTime(token.graduatedAt) : ''}` : `${solRaised.toFixed(2)} SOL raised`}
        </span>
      </span>
      {!token.complete && (
        <span className="shrink-0 text-right">
          <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-surface-raised">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${token.graduationProgressPct}%` }} />
          </span>
          <span className="mt-0.5 block font-mono text-[0.6rem] text-ink-400">{token.graduationProgressPct.toFixed(0)}%</span>
        </span>
      )}
    </div>
  );
}

function TrendingHolderRow({ market }: { market: MarketSummary }) {
  const isUp = (market.priceChange24hPct ?? 0) >= 0;
  return (
    <Link
      // Chain-aware URL as of 2026-09-16 (BNB Chain going live).
      href={`/market/${slugForIdentifier(market.chainIdentifier) ?? DEFAULT_CHAIN_SLUG}/${market.tokenAddress}`}
      className="flex items-center gap-2.5 border-b border-line/60 px-3 py-2.5 transition-colors hover:bg-surface-raised"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised font-display text-xs font-bold text-ink-600">
        {(market.symbol ?? market.tokenAddress).slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-semibold text-ink-900">${market.symbol ?? truncateAddress(market.tokenAddress)}</span>
        <span className="block font-mono text-[0.65rem] text-ink-400">{formatCompactUsd(market.marketCapUsd)} MC</span>
      </span>
      <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold', isUp ? 'bg-up/15 text-up' : 'bg-down/15 text-down')}>
        {formatPercent(market.priceChange24hPct)}
      </span>
    </Link>
  );
}
