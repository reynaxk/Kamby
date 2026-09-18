'use client';

import { useState } from 'react';
import type { SocialActivity } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatRelativeTime, truncateAddress } from '@/lib/format';

type Tab = 'transactions' | 'holders' | 'caller-alpha';
const TABS: { id: Tab; label: string }[] = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'holders', label: 'Holders' },
  { id: 'caller-alpha', label: 'Caller Alpha' },
];

/**
 * Bottom data hub in the terminal, ported to production 2026-09-16 — see KambyTerminal.tsx.
 * `transactions` is real: `activity` is the same server-fetched `SocialActivity[]` the page
 * already loads for this exact token (see app/market/[chain]/[address]/page.tsx), not a
 * second client-side fetch and not the fake-stream `setInterval` this used to run in the
 * mock preview. `holders` and `caller-alpha` show an honest "— soon" placeholder, matching
 * SmartSlipGasBar's own Jito-tip/Anti-MEV pattern — no backend data source exists for
 * either yet (holder-percentage tracking, or any caller-alpha feed at all), and a fake row
 * next to real ones is worse than admitting the gap.
 */
export function DataHub({ activity }: { activity: SocialActivity[] }) {
  const [tab, setTab] = useState<Tab>('transactions');

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wide transition-colors',
              tab === t.id ? 'border-b-2 border-accent text-ink-900' : 'text-ink-400 hover:text-ink-600',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {tab === 'transactions' && (
          activity.length === 0 ? (
            <p className="p-4 text-ink-400">No activity indexed yet for this token.</p>
          ) : (
            <table className="w-full">
              <tbody>
                {activity.map((row) => (
                  <tr key={row.id} className="border-b border-line/50">
                    <td className="px-3 py-1.5 text-ink-400">{formatRelativeTime(row.timestamp)}</td>
                    <td className="px-3 py-1.5 text-ink-600">
                      {row.trader.address ? truncateAddress(row.trader.address) : 'Unknown'}
                    </td>
                    <td className={cn('px-3 py-1.5 font-semibold', row.action === 'BUY' ? 'text-up' : 'text-down')}>
                      {row.action}
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink-900">
                      ${row.amountUsd.toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-1.5 text-ink-400">{truncateAddress(row.txHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
        {tab === 'holders' && (
          <p className="p-4 text-ink-400">
            Holder tracking <span className="text-ink-400">— soon</span>.
          </p>
        )}
        {tab === 'caller-alpha' && (
          <p className="p-4 text-ink-400">
            Caller alpha <span className="text-ink-400">— soon</span>.
          </p>
        )}
      </div>
    </div>
  );
}
