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

const EXPLORER: Record<'solana' | 'base' | 'bnb' | 'robinhood', (address: string) => string> = {
  solana: (a) => `https://solscan.io/account/${a}`,
  base: (a) => `https://basescan.org/address/${a}`,
  bnb: (a) => `https://bscscan.com/address/${a}`,
  robinhood: (a) => `https://robinhoodchain.blockscout.com/address/${a}`,
};

/**
 * A coin's largest holders (user request 2026-10-04 — the Holders tab was an empty "soon"
 * placeholder), each with its USD value at the live price and a whale (≥$1M) / shark (≥$500K)
 * / fish (≥$100K) label. Pools and other contracts are shown but never labelled.
 */
export function HoldersPanel({ source, onCount }: { source: ChartSource; onCount?: (count: number) => void }) {
  const tU = useTranslations('ui');
  const tC = useTranslations('coin');
  const tL = useTranslations('labels');
  const { chain, address } = livePriceKey(source);
  // The API's known tags, in the viewer's language; anything else as sent.
  const tagLabel = (tag: string) => (tag === 'Pool / curve' ? tL('holderPool') : tag);
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
          if (body.holderCount !== null) onCount?.(body.holderCount);
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

  if (status === 'loading') {
    // Rows shaped like the real list while it loads (2026-10-16) — the text stays for screen readers.
    return (
      <div className="flex flex-col gap-1 px-4 py-3" role="status" aria-label={tC('loadingHolders')}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <span className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-white/[0.05]" />
            <span className="flex-1 space-y-1.5">
              <span className="block h-3 w-28 animate-pulse rounded-full bg-white/[0.06]" />
              <span className="block h-2 w-20 animate-pulse rounded-full bg-white/[0.04]" />
            </span>
            <span className="h-3 w-14 animate-pulse rounded-full bg-white/[0.06]" />
          </div>
        ))}
      </div>
    );
  }
  if (status === 'error' || !data || data.holders.length === 0) {
    return <p className="p-4 text-ink-400">{tC('noHolders')}</p>;
  }

  const topPercent = Math.max(0, ...data.holders.map((h) => h.percent));

  return (
    <div className="flex flex-col">
      {data.holderCount !== null && (
        <p className="border-b border-line/60 px-3 py-1.5 font-mono text-[0.7rem] text-ink-400 max-md:border-0 max-md:px-4 max-md:pt-3">
          {tC('holdersTop', { count: data.holderCount.toLocaleString('en-US'), top: data.holders.length })}
        </p>
      )}
      {/* Phones: an app list like fomo's holders tab, not a table (2026-10-10). 2026-10-15: a rank tile
          (top 3 in neon) and a thin share bar per holder, scaled to the largest one so a 1% holder still
          reads next to a 30% pool. */}
      <ul className="md:hidden">
        {data.holders.map((h, i) => {
          const valueUsd = price !== null ? h.balance * price : null;
          const tier = !h.isContract && valueUsd !== null ? holderTier(valueUsd) : null;
          const pct = `${h.percent < 0.01 ? '<0.01' : h.percent.toFixed(2)}%`;
          const share = topPercent > 0 ? Math.max(4, (h.percent / topPercent) * 100) : 0;
          return (
            <li key={h.address}>
              <a href={EXPLORER[chain](h.address)} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-2.5 active:bg-white/[0.03]">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border font-display text-sm font-bold tabular-nums',
                    i < 3 ? 'border-accent/25 bg-accent/[0.08] text-accent' : 'border-white/[0.06] bg-white/[0.03] text-ink-400',
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate font-display text-[0.95rem] font-semibold text-ink-900">
                    {h.tag ? tagLabel(h.tag) : truncateAddress(h.address)}
                    {tier && <span aria-label={tL(`tier_${tier}`)}>{TIER_STYLE[tier].icon}</span>}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1 w-20 overflow-hidden rounded-full bg-white/[0.06]">
                      <span className={cn('block h-full rounded-full', h.isContract ? 'bg-ink-400/60' : 'bg-gradient-to-r from-accent to-[#00B4D8]')} style={{ width: `${share}%` }} />
                    </span>
                    <span className="font-body text-xs tabular-nums text-ink-400">{tL('ofSupply', { pct })}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-body text-[0.95rem] font-semibold tabular-nums text-ink-900">{valueUsd !== null ? formatCompactUsd(valueUsd) : '—'}</span>
                  {!tier && h.isContract && <span className="block font-body text-[0.65rem] text-ink-400">{h.tag ? '' : tL('holderContract')}</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <table className="w-full font-mono text-[0.75rem] max-md:hidden">
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
                    {(h.isContract || h.tag) && <span className="text-[0.62rem] text-ink-400">{h.tag ? tagLabel(h.tag) : tL('holderContract')}</span>}
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
