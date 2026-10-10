'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { fetchLivePrice, type ChartSource } from '@/lib/chart-data';
import { fetchGeckoTrades, geckoNetworkFor, type GeckoTrade } from '@/lib/gecko-browser';
import { formatCompactUsd, truncateAddress } from '@/lib/format';

const POLL_MS = 15_000;
const EXPLORER_TX: Record<string, (hash: string) => string> = {
  solana: (h) => `https://solscan.io/tx/${h}`,
  base: (h) => `https://basescan.org/tx/${h}`,
  bsc: (h) => `https://bscscan.com/tx/${h}`,
};

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/**
 * A coin's live trades on every DEX, for its phone screen's Trades tab (2026-10-10) — like
 * fomo's feed of buys and sells. From GeckoTerminal in the viewer's own browser (free, own
 * rate budget, same as the chart's fallback), on the coin's chart pool, every 15s while the
 * tab is visible. New trades slide in at the top; rows already shown never move.
 */
export function LiveTradesPanel({ source }: { source: ChartSource }) {
  const tT = useTranslations('terminal');
  const tU = useTranslations('ui');
  const [trades, setTrades] = useState<GeckoTrade[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const network = geckoNetworkFor(source.kind === 'solana' ? { kind: 'solana' } : { kind: 'evm', chainId: source.chainId });
  const token = source.kind === 'solana' ? source.mint : source.address;

  useEffect(() => {
    if (!network) return;
    let cancelled = false;
    let pool: string | undefined;
    seen.current = new Set();
    setTrades(null);
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      pool ??= await fetchLivePrice(source).then((p) => p?.poolAddress).catch(() => undefined);
      const next = await fetchGeckoTrades(network, token, pool);
      if (cancelled) return;
      if (!next) {
        setFailed((f) => f || seen.current.size === 0);
        return;
      }
      const first = seen.current.size === 0;
      const added = new Set(next.filter((t) => !seen.current.has(t.txHash)).map((t) => t.txHash));
      next.forEach((t) => seen.current.add(t.txHash));
      setFresh(first ? new Set() : added);
      setTrades(next.slice(0, 50));
      setFailed(false);
      setNow(Date.now());
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [network, token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!network) return null;
  if (trades === null) {
    return <p className="p-4 font-body text-sm text-ink-400">{failed ? tU('couldnTLoadActivity_bd85') : tU('loading_5f02')}</p>;
  }
  if (trades.length === 0) return <p className="p-4 font-body text-sm text-ink-400">{tU('noTradesYet_ceb3')}</p>;

  return (
    <ul>
      {trades.map((t) => (
        <li key={t.txHash} className={cn(fresh.has(t.txHash) && 'animate-[kamby-slide-in_0.4s_ease-out]')}>
          <a href={EXPLORER_TX[network]?.(t.txHash)} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-2.5 active:bg-white/5">
            <span
              className={cn(
                'w-12 shrink-0 rounded-full py-0.5 text-center font-display text-[0.7rem] font-bold',
                t.side === 'BUY' ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
              )}
            >
              {tT(t.side === 'BUY' ? 'buy' : 'sell')}
            </span>
            <span className="min-w-0 flex-1 truncate font-body text-sm text-ink-600">{truncateAddress(t.trader)}</span>
            <span className={cn('shrink-0 font-body text-sm font-semibold tabular-nums', t.side === 'BUY' ? 'text-up' : 'text-down')}>
              {formatCompactUsd(t.amountUsd)}
            </span>
            <span className="w-8 shrink-0 text-right font-body text-xs tabular-nums text-ink-400">{ago(t.atMs, now)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
