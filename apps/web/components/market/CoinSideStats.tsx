'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TOKEN_STATS_WINDOWS, type TokenInfoChain, type TokenStatsWindow } from '@kamby/domain';
import { cn } from '@kamby/ui';
import type { ChartSource } from '@/lib/chart-data';
import { formatCompactUsd } from '@/lib/format';
import { useTokenStats } from '@/lib/use-live-price';
import { useHolderSummary } from './CoinInfoTab';
import { formatAge } from './TokenStatsStrip';

const LABEL: Record<TokenStatsWindow, string> = { m5: '5m', h1: '1h', h6: '6h', h24: '24h' };

/**
 * The coin's numbers beside the trade panel (2026-11-02, owner: GMGN + Axiom "mixed"): a
 * 5m / 1h / 6h / 24h change row — pick one to see its volume and buys vs sells — then the coin's
 * facts (holders, top 10, liquidity, FDV, age). Only data Kamby really has; nothing estimated.
 */
export function CoinSideStats({ source, chain, address, className }: { source: ChartSource; chain: TokenInfoChain; address: string; className?: string }) {
  const t = useTranslations('coin');
  const stats = useTokenStats(source);
  const holders = useHolderSummary(chain, address);
  const [win, setWin] = useState<TokenStatsWindow>('h24');
  if (!stats) return null;

  const txns = stats.txns?.[win] ?? (win === 'h24' ? { ...stats.txns24h, buyers: null, sellers: null } : win === 'h1' ? { ...stats.txns1h, buyers: null, sellers: null } : null);
  const total = txns ? txns.buys + txns.sells : 0;
  const buyShare = total > 0 && txns ? (txns.buys / total) * 100 : 50;
  const mc = stats.marketCapUsd ?? null;
  const showFdv = stats.fdvUsd !== null && (mc === null || Math.abs(stats.fdvUsd - mc) > mc * 0.01);
  const facts: [string, string][] = [
    ...(holders.count !== null ? [[t('holders'), holders.count.toLocaleString('en-US')] as [string, string]] : []),
    ...(holders.top10Pct !== null ? [[t('sideTop10'), `${holders.top10Pct.toFixed(1)}%`] as [string, string]] : []),
    ...(stats.liquidityUsd != null ? [[t('liquidity'), formatCompactUsd(stats.liquidityUsd)] as [string, string]] : []),
    ...(showFdv ? [[t('fdv'), formatCompactUsd(stats.fdvUsd)] as [string, string]] : []),
    ...(stats.pairCreatedAtMs !== null ? [[t('age'), formatAge(stats.pairCreatedAtMs)] as [string, string]] : []),
  ];

  return (
    <section className={cn('overflow-hidden rounded-xl border border-white/[0.06] bg-surface', className)}>
      <div role="tablist" className="grid grid-cols-4 border-b border-white/[0.06]">
        {TOKEN_STATS_WINDOWS.map((w) => {
          const pct = stats.priceChangePct[w];
          const on = w === win;
          return (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setWin(w)}
              className={cn('py-2 text-center transition-colors', on ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]')}
            >
              <span className={cn('block font-body text-[0.7rem]', on ? 'text-ink-900' : 'text-ink-400')}>{LABEL[w]}</span>
              <span className={cn('block font-mono text-xs font-semibold tabular-nums', pct === null || pct === 0 ? 'text-ink-600' : pct > 0 ? 'text-up' : 'text-down')}>
                {pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) >= 100 ? 0 : 2)}%`}
              </span>
            </button>
          );
        })}
      </div>

      <dl className="grid grid-cols-3 gap-2 px-3 py-2.5">
        <Cell label={t('vol')} value={formatCompactUsd(stats.volumeUsd[win])} />
        <Cell label={t('sideBuys')} value={txns ? txns.buys.toLocaleString('en-US') : '—'} tone="up" />
        <Cell label={t('sideSells')} value={txns ? txns.sells.toLocaleString('en-US') : '—'} tone="down" />
      </dl>
      {txns && total > 0 && (
        <div className="mx-3 mb-3 flex h-1 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          <span className="rounded-full bg-up" style={{ width: `${buyShare}%` }} />
          <span className="flex-1 rounded-full bg-down" />
        </div>
      )}

      {facts.length > 0 && (
        <dl className="grid grid-cols-3 gap-2 border-t border-white/[0.06] px-3 py-2.5">
          {facts.map(([label, value]) => (
            <Cell key={label} label={label} value={value} />
          ))}
        </dl>
      )}
    </section>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="min-w-0">
      <dt className="truncate font-body text-[0.7rem] text-ink-400">{label}</dt>
      <dd className={cn('truncate font-mono text-xs font-semibold tabular-nums', tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink-900')}>{value}</dd>
    </div>
  );
}
