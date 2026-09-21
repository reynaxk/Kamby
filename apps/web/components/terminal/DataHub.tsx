'use client';

import { useMemo, useState } from 'react';
import type { ActivityAction, SocialActivity } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatRelativeTime, truncateAddress } from '@/lib/format';

type Tab = 'transactions' | 'holders' | 'caller-alpha';
const TABS: { id: Tab; label: string }[] = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'holders', label: 'Holders' },
  { id: 'caller-alpha', label: 'Caller Alpha' },
];

type ActionFilter = 'ALL' | ActivityAction;
const ACTION_FILTERS: ActionFilter[] = ['ALL', 'BUY', 'SELL'];
const MIN_SIZE_OPTIONS = [0, 1_000, 5_000] as const;

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
  const [actionFilter, setActionFilter] = useState<ActionFilter>('ALL');
  const [minSizeUsd, setMinSizeUsd] = useState<number>(0);
  const [traderQuery, setTraderQuery] = useState('');

  const filteredActivity = useMemo(() => {
    const needle = traderQuery.trim().toLowerCase();
    return activity.filter((row) => {
      if (actionFilter !== 'ALL' && row.action !== actionFilter) return false;
      if (row.amountUsd < minSizeUsd) return false;
      if (needle && !row.trader.address?.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [activity, actionFilter, minSizeUsd, traderQuery]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-3.5 py-2 font-display text-xs font-bold uppercase tracking-wide transition-all',
              tab === t.id ? 'border-b-2 border-accent text-ink-900 shadow-[inset_0_-8px_12px_-10px_rgb(var(--kamby-accent)/0.5)]' : 'text-ink-400 hover:text-ink-600',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'transactions' && activity.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-2.5 py-1.5 font-mono text-[0.65rem] text-ink-400">
          <div className="inline-flex rounded-md border border-line bg-surface-raised p-0.5">
            {ACTION_FILTERS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setActionFilter(a)}
                className={cn(
                  'rounded px-1.5 py-0.5 font-semibold uppercase transition-colors',
                  actionFilter === a ? 'bg-accent text-accent-ink' : 'text-ink-400 hover:text-ink-900',
                )}
              >
                {a === 'ALL' ? 'All' : a}
              </button>
            ))}
          </div>
          <select
            value={minSizeUsd}
            onChange={(e) => setMinSizeUsd(Number(e.target.value))}
            className="rounded border border-line bg-surface-raised px-1 py-0.5 text-ink-900"
          >
            {MIN_SIZE_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v === 0 ? 'Any size' : `>$${v.toLocaleString('en-US')}`}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={traderQuery}
            onChange={(e) => setTraderQuery(e.target.value)}
            placeholder="Filter by trader address…"
            className="min-w-0 flex-1 rounded border border-line bg-surface-raised px-1.5 py-0.5 text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {tab === 'transactions' && (
          activity.length === 0 ? (
            <p className="p-4 text-ink-400">No activity indexed yet for this token.</p>
          ) : filteredActivity.length === 0 ? (
            <p className="p-4 text-ink-400">No activity matches these filters.</p>
          ) : (
            <table className="w-full">
              <tbody>
                {filteredActivity.map((row) => (
                  <tr key={row.id} className="border-b border-line/50">
                    <td className="px-2.5 py-1 tracking-tight text-ink-400" suppressHydrationWarning>
                      {formatRelativeTime(row.timestamp)}
                    </td>
                    <td className="px-2.5 py-1 tracking-tight text-ink-600">
                      {row.trader.address ? truncateAddress(row.trader.address) : 'Unknown'}
                    </td>
                    <td className={cn('px-2.5 py-1 font-semibold', row.action === 'BUY' ? 'text-up' : 'text-down')}>
                      {row.action}
                    </td>
                    <td className="px-2.5 py-1 text-right tabular-nums text-ink-900">
                      ${row.amountUsd.toLocaleString('en-US')}
                    </td>
                    <td className="px-2.5 py-1 tracking-tight text-ink-400">{truncateAddress(row.txHash)}</td>
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
