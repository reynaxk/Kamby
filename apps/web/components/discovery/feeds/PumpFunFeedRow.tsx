'use client';

import Link from 'next/link';
import { ChainBadge } from '@/components/market/ChainBadge';
import type { PumpFunTokenSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { cashtag, formatAge, truncateAddress } from '@/lib/format';
import { solanaMarketHref } from '@/lib/solana-links';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { useTranslations } from 'next-intl';
import { QuickBuyButton } from '@/components/trading/QuickBuy';

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
            ? `Graduated ${token.graduatedAt ? formatAge(token.graduatedAt) : ''}`
            : `${solAmount(lamportsToSol(token.realSolReserves))} SOL · ${formatAge(token.createdAt)}`}
        </span>
      </span>
      {token.complete ? (
        <span className="shrink-0 rounded-full bg-up/15 px-1.5 py-0.5 font-mono text-[0.66rem] font-semibold uppercase text-up">{tU('trade_5f39')}</span>
      ) : (
        <span className="shrink-0 text-right" aria-label={`${token.graduationProgressPct.toFixed(0)}% of the way to graduating`}>
          {/* The curve, a bit louder (2026-10-15): a thicker bar filling cyan → neon, a tiny stub even
              at 0% so it reads as a bar, and the % brighter the closer the coin is to graduating. */}
          <span className={cn('block overflow-hidden rounded-full bg-white/[0.06]', emphasizeProgress ? 'h-2.5 w-20' : 'h-2 w-16')}>
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max(4, token.graduationProgressPct)}%`, background: 'linear-gradient(90deg,#00E5FF,#00FF87)' }}
            />
          </span>
          <span
            className={cn(
              'mt-1 block font-display text-[0.72rem] font-bold tabular-nums',
              token.graduationProgressPct >= 80 ? 'text-up' : token.graduationProgressPct >= 30 ? 'text-ink-900' : 'text-ink-400',
            )}
          >
            {token.graduationProgressPct.toFixed(0)}%
          </span>
        </span>
      )}
    </>
  );
  // Every coin opens its trade page — bonding-curve coins included (user decision 2026-10-03;
  // Jupiter routes Pump.fun curves). The trade page shows the early-stage risk warning.
  return (
    <div className="flex items-center border-b border-line/60 transition-colors hover:bg-surface-raised">
      <Link href={solanaMarketHref(token.mintAddress)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2.5">
        {content}
      </Link>
      <QuickBuyButton chainIdentifier="solana" address={token.mintAddress} label={token.symbol ? cashtag(token.symbol) : truncateAddress(token.mintAddress)} className="mr-2.5" />
    </div>
  );
}

/** "0.97" / "14.9K" — big reserves read at a glance in a tight row. */
function solAmount(sol: number): string {
  return sol >= 1000 ? `${(sol / 1000).toFixed(1)}K` : sol.toFixed(2);
}
