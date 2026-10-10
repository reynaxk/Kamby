'use client';

import { useEffect, useState } from 'react';
import { holderTier, type HolderTier, type TokenHolders } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { livePriceKey, type ChartSource } from '@/lib/chart-data';
import { formatCompactUsd, truncateAddress } from '@/lib/format';
import { API_BASE } from '@/lib/session-client';
import { useLivePrice } from '@/lib/use-live-price';
import { useTranslations } from 'next-intl';

const REFRESH_MS = 60_000; // the API caches holders for a minute

const TIER_STYLE: Record<HolderTier, { label: string; icon: string; className: string }> = {
  whale: { label: 'Whale', icon: '🐋', className: 'bg-accent/15 text-accent' },
  shark: { label: 'Shark', icon: '🦈', className: 'bg-warn/15 text-warn' },
  fish: { label: 'Fish', icon: '🐟', className: 'bg-up/15 text-up' },
};

const EXPLORER: Record<'solana' | 'base' | 'bnb', (address: string) => string> = {
  solana: (a) => `https://solscan.io/account/${a}`,
  base: (a) => `https://basescan.org/address/${a}`,
  bnb: (a) => `https://bscscan.com/address/${a}`,
};

/**
 * A coin's largest holders (user request 2026-10-04 — the Holders tab was an empty "soon"
 * placeholder), each with its USD value at the live price and a whale (≥$1M) / shark (≥$500K)
 * / fish (≥$100K) label. Pools and other contracts are shown but never labelled.
 */
export function HoldersPanel({ source }: { source: ChartSource }) {
  const tU = useTranslations('ui');
  const tC = useTranslations('coin');
  const tL = useTranslations('labels');
  const { chain, address } = livePriceKey(source);
  const price = useLivePrice(source);
  const [data, setData] = useState<TokenHolders | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setStatus('loading');
    // The first load always runs (2026-10-10: a coin opened in a background tab skipped it and
    // sat on "Loading holders…" until the next refresh); refreshes only while visible.
    const load = async (refresh = false) => {
      if (refresh && document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`${API_BASE}/v1/market/holders/${chain}/${encodeURIComponent(address)}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as TokenHolders;
        if (!cancelled) {
          setData(body);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus((s) => (s === 'ready' ? s : 'error'));
      }
    };
    void load();
    const timer = setInterval(() => void load(true), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [chain, address]);

  if (status === 'loading') return <p className="p-4 text-ink-400">{tC('loadingHolders')}</p>;
  if (status === 'error' || !data || data.holders.length === 0) {
    return <p className="p-4 text-ink-400">{tC('noHolders')}</p>;
  }

  return (
    <div className="flex flex-col">
      {data.holderCount !== null && (
        <p className="border-b border-line/60 px-3 py-1.5 font-mono text-[0.7rem] text-ink-400">
          {tC('holdersTop', { count: data.holderCount.toLocaleString('en-US'), top: data.holders.length })}
        </p>
      )}
      <table className="w-full font-mono text-[0.75rem]">
        <thead>
          <tr className="text-left text-ink-400">
            <th className="px-3 py-1.5 font-medium">#</th>
            <th className="px-3 py-1.5 font-medium">{tU('holder_d6a0')}</th>
            <th className="px-3 py-1.5 text-right font-medium">{tL('holderShare')}</th>
            <th className="px-3 py-1.5 text-right font-medium">{tU('value_6892')}</th>
          </tr>
        </thead>
        <tbody>
          {data.holders.map((h, i) => {
            const valueUsd = price !== null ? h.balance * price : null;
            const tier = !h.isContract && valueUsd !== null ? holderTier(valueUsd) : null;
            return (
              <tr key={h.address} className="border-t border-line/40">
                <td className="px-3 py-1.5 text-ink-400">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <a href={EXPLORER[chain](h.address)} target="_blank" rel="noreferrer" className="text-ink-900 hover:text-accent">
                      {truncateAddress(h.address)}
                    </a>
                    {tier && (
                      <span className={cn('rounded-full px-1.5 py-0.5 text-[0.62rem] font-semibold', TIER_STYLE[tier].className)}>
                        {TIER_STYLE[tier].icon} {tL(`tier_${tier}`)}
                      </span>
                    )}
                    {(h.isContract || h.tag) && <span className="text-[0.62rem] text-ink-400">{h.tag ?? 'contract'}</span>}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-600">{h.percent < 0.01 ? '<0.01' : h.percent.toFixed(2)}%</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-900">{valueUsd !== null ? formatCompactUsd(valueUsd) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
