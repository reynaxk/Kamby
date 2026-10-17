'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TokenPosition } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { fetchMyPositions } from '@/lib/discovery-client';
import { cashtag, formatPercent } from '@/lib/format';

/** Your open positions to pick one from — a PnL card or a Trade Card (chats, live rooms). */
export function PositionPicker({ open, onClose, onPick, title }: { open: boolean; onClose: () => void; onPick: (p: TokenPosition) => void; title?: string }) {
  const t = useTranslations('dm');
  const [positions, setPositions] = useState<TokenPosition[] | null>(null);
  useEffect(() => {
    if (!open) return;
    fetchMyPositions()
      .then((rows) => setPositions(rows.filter((p) => p.currentValueUsd !== null && p.costBasisUsd > 0)))
      .catch(() => setPositions([]));
  }, [open]);
  return (
    <MobileDrawer open={open} onClose={onClose} title={title ?? t('attachPnl')} desktop>
      {positions?.length === 0 && <p className="py-6 text-center font-body text-sm text-ink-400">{t('noPositions')}</p>}
      <ul className="max-h-[50vh] overflow-y-auto">
        {positions?.map((p) => {
          const up = (p.unrealizedPnlUsd ?? 0) >= 0;
          return (
            <li key={`${p.chainIdentifier ?? p.chain}:${p.tokenAddress}`}>
              <button type="button" onClick={() => onPick(p)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left active:bg-white/[0.05]">
                <TokenAvatar src={p.logoUrl} seed={p.tokenAddress} label={p.symbol ?? p.tokenAddress} className="h-9 w-9 text-xs" />
                <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-ink-900">{cashtag(p.symbol ?? p.tokenAddress.slice(0, 6))}</span>
                <span className={cn('font-display text-sm font-bold tabular-nums', up ? 'text-up' : 'text-down')}>{p.unrealizedPnlPct !== null ? formatPercent(p.unrealizedPnlPct) : '—'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </MobileDrawer>
  );
}
