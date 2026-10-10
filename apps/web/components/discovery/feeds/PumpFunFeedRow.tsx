'use client';

import Link from 'next/link';
import { ChainBadge } from '@/components/market/ChainBadge';
import type { PumpFunTokenSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { cashtag, formatRelativeTime, truncateAddress } from '@/lib/format';
import { solanaMarketHref } from '@/lib/solana-links';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { useTranslations } from 'next-intl';

function lamportsToSol(raw: string): number {
  return Number(raw) / 1_000_000_000;
}

/**
 * A Pump.fun coin in the Trenches / Bonding / Graduated tabs. Coins still on the bonding
 * curve are browse-only (a product decision, 2026-09-30 — most of them go to zero within
 * hours), so those rows don't link anywhere; a graduated coin trades on Solana through
 * Jupiter and links to its Solana trade page. The progress bar updates live as the stream
 * pushes new curve state.
 */
export function PumpFunFeedRow({ token, emphasizeProgress = false }: { token: PumpFunTokenSummary; emphasizeProgress?: boolean }) {
  const tU = useTranslations('ui');
  const content = (
    <>
      <span className="relative shrink-0">
        <TokenAvatar src={token.imageUrl} seed={token.mintAddress} label={token.symbol ?? token.name} className="h-9 w-9 text-[0.85rem]" />
        <ChainBadge chain="solana" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[0.88rem] font-semibold tracking-tight text-ink-900">
          {token.symbol ? cashtag(token.symbol) : truncateAddress(token.mintAddress)}
        </span>
        <span className="block truncate font-mono text-[0.7rem] tabular-nums text-ink-400" suppressHydrationWarning>
          {token.complete
            ? `Graduated ${token.graduatedAt ? formatRelativeTime(token.graduatedAt) : ''}`
            : `${lamportsToSol(token.realSolReserves).toFixed(2)} SOL · ${formatRelativeTime(token.createdAt)}`}
        </span>
      </span>
      {token.complete ? (
        <span className="shrink-0 rounded-full bg-up/15 px-1.5 py-0.5 font-mono text-[0.66rem] font-semibold uppercase text-up">{tU('trade_5f39')}</span>
      ) : (
        <span className="shrink-0 text-right" aria-label={`${token.graduationProgressPct.toFixed(0)}% of the way to graduating`}>
          <span className={cn('block overflow-hidden rounded-full bg-surface-raised', emphasizeProgress ? 'h-2 w-20' : 'h-1.5 w-14')}>
            <span
              className={cn('block h-full rounded-full transition-[width] duration-500', token.graduationProgressPct >= 80 ? 'bg-up' : 'bg-accent')}
              style={{ width: `${token.graduationProgressPct}%` }}
            />
          </span>
          <span className="mt-0.5 block font-mono text-[0.7rem] tabular-nums text-ink-400">{token.graduationProgressPct.toFixed(0)}%</span>
        </span>
      )}
    </>
  );
  // Every coin opens its trade page — bonding-curve coins included (user decision 2026-10-03;
  // Jupiter routes Pump.fun curves). The trade page shows the early-stage risk warning.
  const className = 'flex items-center gap-2.5 border-b border-line/60 px-2.5 py-2.5';
  return (
    <Link href={solanaMarketHref(token.mintAddress)} className={cn(className, 'transition-colors hover:bg-surface-raised')}>
      {content}
    </Link>
  );
}
