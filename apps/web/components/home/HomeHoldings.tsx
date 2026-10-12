'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { useMyPositions } from '@/lib/my-positions';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { marketHref } from '@/lib/solana-links';
import { cashtag, formatCompactUsd, formatPercent, formatTokenAmount } from '@/lib/format';

/**
 * Home's "Your coins" (2026-10-10, real-trading-app feel: your holdings come before the market)
 * — each coin you hold with its value and profit, one tap to its screen. Nothing when you hold
 * nothing. Phones only; desktop has the terminal's positions panel.
 */
export function HomeHoldings() {
  const t = useTranslations('labels');
  const positions = useMyPositions();
  const { hidden } = useBalanceVisibility();
  if (!positions || positions.length === 0) return null;

  return (
    <section className="mt-3 px-4 md:hidden">
      <h2 className="px-1 pb-1.5 font-display text-sm font-semibold text-ink-400">{t('yourCoins')}</h2>
      <ul className="kamby-glass overflow-hidden rounded-3xl">
        {positions.map((p) => {
          const chainId = p.chainIdentifier ?? (p.chain === 'solana' ? 'solana' : null);
          const href = chainId ? marketHref(chainId, p.tokenAddress) : null;
          const chain = chainId ? badgeChainFor(chainId) : null;
          const up = (p.unrealizedPnlUsd ?? 0) >= 0;
          const row = (
            <>
              <span className="relative shrink-0">
                <TokenAvatar src={p.logoUrl} seed={p.tokenAddress} label={p.symbol ?? p.name} className="h-10 w-10 text-sm" />
                {chain && <ChainBadge chain={chain} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-semibold text-ink-900">{cashtag(p.symbol ?? p.tokenAddress.slice(0, 6))}</span>
                {/* How many coins you hold (owner 2026-10-12: "can't see the amount of bought coins"). */}
                <span className={cn('block truncate font-body text-xs tabular-nums text-ink-400', hidden && 'select-none blur-sm')}>
                  {formatTokenAmount(p.quantity)} {p.symbol ?? ''}
                </span>
              </span>
              <span className={cn('shrink-0 text-right', hidden && 'select-none blur-sm')}>
                <span className="block font-body text-base font-semibold tabular-nums text-ink-900">{formatCompactUsd(p.currentValueUsd)}</span>
                {p.unrealizedPnlPct !== null && (
                  <span className={cn('block font-body text-xs font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(p.unrealizedPnlPct)}</span>
                )}
              </span>
            </>
          );
          return (
            <li key={`${chainId ?? 'evm'}:${p.tokenAddress}`}>
              {href ? (
                <Link href={href} className="flex items-center gap-3 px-4 py-2.5">
                  {row}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
