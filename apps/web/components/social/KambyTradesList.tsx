import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { KambyTrade } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { cashtag, formatRelativeTime } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A trader's trades placed through Kamby (2026-10-18): coin, Bought/Sold, the dollars, and a
 *  sell's PnL — the profile's "Recent activity" when they trade through Kamby. */
export async function KambyTradesList({ trades }: { trades: KambyTrade[] }) {
  const tU = await getTranslations('ui');
  return (
    <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-3xl border border-white/[0.07] bg-surface">
      {trades.map((t) => {
        const href = marketHref(t.chainIdentifier, t.tokenAddress);
        const chain = badgeChainFor(t.chainIdentifier);
        const buy = t.side === 'BUY';
        const row = (
          <span className="flex items-center gap-3 px-4 py-3">
            <span className="relative shrink-0">
              <TokenAvatar src={t.logoUrl} seed={t.tokenAddress} label={t.symbol ?? '?'} className="h-10 w-10 text-sm" />
              {chain && <ChainBadge chain={chain} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm font-bold text-ink-900">{cashtag(t.symbol ?? t.tokenAddress.slice(0, 6))}</span>
              <span className={cn('block font-body text-xs font-semibold', buy ? 'text-up' : 'text-down')}>
                {buy ? tU('bought_fe5a') : tU('sold_d85a')} · <span className="font-normal text-ink-400" suppressHydrationWarning>{formatRelativeTime(t.at)}</span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-body text-sm font-semibold tabular-nums text-ink-900">{usd(t.amountUsd)}</span>
              {t.pnlUsd !== null && (
                <span className={cn('block font-body text-xs font-semibold tabular-nums', t.pnlUsd >= 0 ? 'text-up' : 'text-down')}>
                  {t.pnlUsd >= 0 ? '+' : '−'}
                  {usd(Math.abs(t.pnlUsd))}
                </span>
              )}
            </span>
          </span>
        );
        return <li key={`${t.side}:${t.tokenAddress}:${t.at}`}>{href ? <Link href={href} className="block transition-colors hover:bg-white/[0.03]">{row}</Link> : row}</li>;
      })}
    </ul>
  );
}
