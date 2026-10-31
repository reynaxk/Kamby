'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { TokenAvatar } from './TokenAvatar';
import { badgeChainFor, ChainBadge } from './ChainBadge';
import { LaunchpadBadge } from './LaunchpadBadge';
import { PriceText } from './PriceText';
import { cashtag, formatCompactUsd, formatPercent } from '@/lib/format';
import { useLivePrice, useTokenStats } from '@/lib/use-live-price';
import type { ChartSource } from '@/lib/chart-data';

/**
 * A coin's header on the desktop coin page (2026-10-29, GMGN-tidy): the coin big — logo, $SYMBOL,
 * name and its contract one click from the clipboard — and on the right the live price, 24h
 * change, market cap and liquidity. Replaces a small title line that said none of that.
 */
export function CoinHeaderDesktop({
  chainIdentifier,
  address,
  symbol,
  name,
  logoUrl,
  source,
  initialPrice,
  change24hPct,
  marketCapUsd,
}: {
  chainIdentifier: string;
  address: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  source: ChartSource;
  initialPrice: number | null;
  change24hPct: number | null;
  marketCapUsd: number | null;
}) {
  const tC = useTranslations('coin');
  const live = useLivePrice(source);
  const stats = useTokenStats(source);
  const [copied, setCopied] = useState(false);
  const price = live ?? initialPrice;
  const change = stats?.priceChangePct.h24 ?? change24hPct;
  const up = (change ?? 0) >= 0;
  const chain = badgeChainFor(chainIdentifier);
  const label = symbol ?? name ?? address.slice(0, 6);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative shrink-0">
          <TokenAvatar src={logoUrl} seed={address} label={label} className="h-12 w-12 text-base" />
          {chain && <ChainBadge chain={chain} />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-2xl font-black tracking-tight text-ink-900">{cashtag(label)}</h1>
            <LaunchpadBadge chain={chainIdentifier} address={address} />
          </div>
          <button
            type="button"
            title={address}
            onClick={() =>
              void navigator.clipboard?.writeText(address).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => undefined,
              )
            }
            className="mt-0.5 flex max-w-full items-center gap-1.5 font-body text-xs text-ink-400 hover:text-ink-900"
          >
            {name && <span className="truncate">{name}</span>}
            <span className="font-mono tabular-nums">· {address.slice(0, 4)}…{address.slice(-4)}</span>
            <span className={cn('shrink-0', copied && 'text-accent')}>{copied ? '✓' : '⧉'}</span>
          </button>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <Fact label={tC('mcap')} value={formatCompactUsd(marketCapUsd)} />
        {/* Only what's known (2026-10-31 tidy pass) — no lone dash while the stats load. */}
        {stats?.volumeUsd.h24 ? <Fact label={tC('vol24')} value={formatCompactUsd(stats.volumeUsd.h24)} /> : null}
        {stats?.liquidityUsd != null && <Fact label={tC('liq')} value={formatCompactUsd(stats.liquidityUsd)} />}
        <div className="text-right">
          <p className="font-display text-2xl font-black tabular-nums leading-none text-ink-900">
            <PriceText value={price} flash />
          </p>
          {change !== null && <p className={cn('mt-1 font-body text-sm font-bold tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(change)} · 24h</p>}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-body text-[0.68rem] font-semibold text-ink-400">{label}</p>
      <p className="font-display text-sm font-bold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}
