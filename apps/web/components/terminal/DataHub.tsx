'use client';

import { useMemo, useState } from 'react';
import type { ActivityAction, SocialActivity } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatRelativeTime, truncateAddress } from '@/lib/format';
import type { ChartSource } from '@/lib/chart-data';
import { HoldersPanel } from './HoldersPanel';
import { LiveTradesPanel } from './LiveTradesPanel';
import { useTranslations } from 'next-intl';

// 2026-10-31 polish: every on-chain trade first (the terminal's tape — DEX coins have no order
// book), then the ones made on Kamby, then holders. The "Thesis — soon" placeholder is gone.
type Tab = 'live' | 'transactions' | 'holders';
const TABS: Tab[] = ['live', 'transactions', 'holders'];

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
export function DataHub({ activity, source = null }: { activity: SocialActivity[]; source?: ChartSource | null }) {
  const tU = useTranslations('ui');
  const tL = useTranslations('labels');
  const [tab, setTab] = useState<Tab>(source ? 'live' : 'transactions');
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
        {TABS.filter((id) => id === 'transactions' || source).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 font-display text-xs font-bold uppercase tracking-wide transition-colors',
              tab === id ? 'border-accent text-ink-900' : 'border-transparent text-ink-400 hover:text-ink-700',
            )}
          >
            {id === 'live' && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-up" />}
            {tL(`hub_${id}`)}
            {id === 'transactions' && activity.length > 0 && <span className="font-mono text-[0.6rem] text-ink-400">{activity.length}</span>}
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
                  actionFilter === a
                    ? 'bg-accent text-accent-ink'
                    : 'text-ink-400 hover:text-ink-900',
                )}
              >
                {a === 'ALL' ? tU('all_b1c9') : a}
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
                {v === 0 ? tU('anySize_ad8e') : `>$${v.toLocaleString('en-US')}`}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={traderQuery}
            onChange={(e) => setTraderQuery(e.target.value)}
            placeholder={tU('filterByTraderAddress_0b07')}
            className="min-w-0 flex-1 rounded border border-line bg-surface-raised px-1.5 py-0.5 text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {tab === 'transactions' &&
          (activity.length === 0 ? (
            <p className="p-4 text-ink-400">{tU('noTradesOnKambyFor_cf58')}</p>
          ) : filteredActivity.length === 0 ? (
            <p className="p-4 text-ink-400">{tU('noActivityMatchesTheseFilters_5a6d')}</p>
          ) : (
            <table className="w-full">
              <tbody>
                {filteredActivity.map((row) => (
                  <tr key={row.id} className="border-b border-line/50">
                    <td
                      className="whitespace-nowrap px-2.5 py-1 tracking-tight text-ink-400"
                      suppressHydrationWarning
                    >
                      {formatRelativeTime(row.timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1 tracking-tight text-ink-600">
                      {/* A Kamby trader by their @name (2026-10-18: it always showed the address). */}
                      {row.trader.displayName ? (
                        <span className="font-semibold text-ink-900">@{row.trader.displayName}</span>
                      ) : row.trader.address ? (
                        truncateAddress(row.trader.address)
                      ) : (
                        tU('unknown_8818')
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-2.5 py-1 font-semibold',
                        row.action === 'BUY' ? 'text-up' : 'text-down',
                      )}
                    >
                      {row.action}
                    </td>
                    <td className="px-2.5 py-1 text-right tabular-nums text-ink-900">
                      ${row.amountUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="hidden px-2.5 py-1 tracking-tight text-ink-400 sm:table-cell">
                      {truncateAddress(row.txHash)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {tab === 'live' && source && <LiveTradesPanel source={source} />}
        {tab === 'holders' && (source ? <HoldersPanel source={source} /> : <p className="p-4 text-ink-400">{tU('pickACoinToSee_a97d')}</p>)}
      </div>
    </div>
  );
}
