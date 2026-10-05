'use client';

import Link from 'next/link';
import type { XxxRiskFlag, XxxRiskToken } from '@kamby/domain';
import { ChainBadge } from '@/components/market/ChainBadge';
import { cashtag, formatCompactUsd, truncateAddress } from '@/lib/format';
import { TokenAvatar } from '@/components/market/TokenAvatar';

const FLAG_LABEL: Record<XxxRiskFlag, string> = {
  mintable: 'Mintable',
  freezable: 'Freezable',
  'dev-holds-over-20pct': 'Dev >20%',
  'top-holders-over-50pct': 'Top holders >50%',
  'unverified-audit': 'Not audited',
};

function age(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** One XXXRisk row: picture, age, liquidity / market cap / 5-minute volume, rug-risk flags. */
export function XxxRiskFeedRow({ token }: { token: XxxRiskToken }) {
  return (
    <Link
      href={`/solana?mint=${encodeURIComponent(token.mintAddress)}`}
      className="flex items-center gap-2 border-b border-line/60 px-2.5 py-2.5 transition-colors hover:bg-surface-raised"
    >
      <span className="relative shrink-0">
        <TokenAvatar src={token.imageUrl} seed={token.mintAddress} label={token.symbol ?? token.name} className="h-9 w-9 text-[0.85rem]" />
        <ChainBadge chain="solana" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-display text-[0.88rem] font-semibold text-ink-900">
            {token.symbol ? cashtag(token.symbol) : truncateAddress(token.mintAddress)}
          </span>
          <span className="shrink-0 font-mono text-[0.7rem] text-ink-400">{age(token.ageSeconds)}</span>
        </span>
        <span className="block truncate font-mono text-[0.7rem] tabular-nums text-ink-400">
          Liq {formatCompactUsd(token.liquidityUsd)} · MC {formatCompactUsd(token.marketCapUsd)}
          {token.traders5m !== null && ` · ${token.traders5m} traders`}
        </span>
        {token.riskFlags.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {token.riskFlags.map((f) => (
              <span key={f} className="rounded bg-down/15 px-1 font-mono text-[0.62rem] font-semibold uppercase text-down">
                {FLAG_LABEL[f]}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right font-mono text-[0.74rem] tabular-nums">
        <span className="block font-semibold text-ink-900">{token.volume5mUsd !== null ? formatCompactUsd(token.volume5mUsd) : '—'}</span>
        <span className="block text-[0.66rem] text-ink-400">5m vol</span>
      </span>
    </Link>
  );
}
