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
export function HomeHoldings({ bare = false, emptyText }: { bare?: boolean; emptyText?: string } = {}) {
  const t = useTranslations('labels');
  const tT = useTranslations('trade');
  const positions = useMyPositions();
  const { hidden } = useBalanceVisibility();
  if (!positions || positions.length === 0) {
    return bare && emptyText && positions ? <p className="py-10 text-center font-body text-sm text-ink-400">{emptyText}</p> : null;
  }

  return (
    // `bare`: the Profile screen's Holdings tab (2026-10-28) — no heading, flat rows.
    <section className={bare ? undefined : 'mt-3 px-4 md:hidden'}>
      {!bare && <h2 className="px-1 pb-1.5 font-display text-sm font-semibold text-ink-400">{t('yourCoins')}</h2>}
      <ul className={bare ? 'divide-y divide-white/[0.05]' : 'kamby-glass overflow-hidden rounded-3xl'}>
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
                // A one-tap Sell beside each holding (2026-10-29, like GMGN's positions): opens the
                // coin on its sell sheet.
                <div className={cn('flex items-center gap-2', bare ? 'pr-1' : 'pr-3')}>
                  <Link href={href} className={cn('flex min-w-0 flex-1 items-center gap-3 py-2.5', bare ? 'pl-1' : 'pl-4')}>
                    {row}
                  </Link>
                  <Link
                    href={`${href}${href.includes('?') ? '&' : '?'}sell=1`}
                    className="flex h-8 shrink-0 items-center rounded-xl border border-down/35 bg-down/10 px-2.5 font-display text-[0.75rem] font-extrabold text-down transition-colors active:scale-[0.97] hover:bg-down hover:text-black"
                  >
                    {tT('sell')}
                  </Link>
                </div>
              ) : (
                <div className={cn('flex items-center gap-3 py-2.5', bare ? 'px-1' : 'px-4')}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
