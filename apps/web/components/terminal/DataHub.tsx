'use client';

import { useEffect, useState } from 'react';
import { cn } from '@kamby/ui';
import {
  MOCK_CALLER_ALPHA,
  MOCK_HOLDERS,
  MOCK_TRANSACTIONS,
  timeAgo,
  type MockFeedRow,
} from './mock-data';

type Tab = 'transactions' | 'holders' | 'caller-alpha';
const TABS: { id: Tab; label: string }[] = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'holders', label: 'Holders' },
  { id: 'caller-alpha', label: 'Caller Alpha' },
];

/** Bottom data hub in the terminal preview's center column — see PreviewBanner: every row
 *  here is mock data. The `transactions` tab appends one fake row every few seconds purely
 *  to demonstrate a "live streaming feed" visually; the random side/amount used for that is
 *  generated client-side in a `useEffect`, after hydration, specifically so it never
 *  produces a server/client markup mismatch (see mock-data.ts's own doc comment). */
export function DataHub() {
  const [tab, setTab] = useState<Tab>('transactions');
  const [rows, setRows] = useState<MockFeedRow[]>(MOCK_TRANSACTIONS);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const stream = setInterval(() => {
      setRows((prev) => {
        const wallets = ['7xKX…q3Rp', 'Bq2m…8fWz', 'Hj9c…2vXe', 'D4mR…6tYs', 'Kp7w…1nBd'];
        const next: MockFeedRow = {
          id: `t-${Date.now()}`,
          timestamp: Date.now(),
          wallet: wallets[Math.floor(Math.random() * wallets.length)]!,
          side: Math.random() > 0.5 ? 'BUY' : 'SELL',
          amountUsd: Math.round(20 + Math.random() * 1500),
          signature: `${Math.random().toString(36).slice(2, 6)}…${Math.random().toString(36).slice(2, 6)}`,
        };
        return [next, ...prev].slice(0, 12);
      });
    }, 5000);
    return () => clearInterval(stream);
  }, []);

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
          <table className="w-full">
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line/50">
                  <td className="px-3 py-1.5 text-ink-400">{timeAgo(row.timestamp, now)}</td>
                  <td className="px-3 py-1.5 text-ink-600">{row.wallet}</td>
                  <td className={cn('px-3 py-1.5 font-semibold', row.side === 'BUY' ? 'text-up' : 'text-down')}>{row.side}</td>
                  <td className="px-3 py-1.5 text-right text-ink-900">${row.amountUsd.toLocaleString('en-US')}</td>
                  <td className="px-3 py-1.5 text-ink-400">{row.signature}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'holders' && (
          <table className="w-full">
            <tbody>
              {MOCK_HOLDERS.map((holder) => (
                <tr key={holder.wallet} className="border-b border-line/50">
                  <td className="px-3 py-1.5 text-ink-600">{holder.wallet}</td>
                  <td className="px-3 py-1.5 text-ink-900">{holder.pct.toFixed(1)}%</td>
                  <td className="px-3 py-1.5 text-right text-ink-900">${holder.amountUsd.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'caller-alpha' && (
          <table className="w-full">
            <tbody>
              {MOCK_CALLER_ALPHA.map((caller) => (
                <tr key={`${caller.handle}-${caller.timestamp}`} className="border-b border-line/50">
                  <td className="px-3 py-1.5 text-ink-400">{timeAgo(caller.timestamp, now)}</td>
                  <td className="px-3 py-1.5 text-ink-900">{caller.handle}</td>
                  <td className={cn('px-3 py-1.5 font-semibold', caller.side === 'BUY' ? 'text-up' : 'text-down')}>{caller.side}</td>
                  <td className="px-3 py-1.5 text-ink-400">{caller.wallet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
