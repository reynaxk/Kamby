'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { TOKEN_STATS_WINDOWS, type TokenHolders, type TokenInfoChain, type TokenStatsWindow } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenLinks } from '@/components/terminal/TokenLinks';
import { CopyAddressButton } from '@/components/social/CopyAddressButton';
import type { ChartSource } from '@/lib/chart-data';
import { cashtag, formatCompactCount, formatCompactUsd } from '@/lib/format';
import { launchpadFor } from '@/lib/launchpad';
import { API_BASE } from '@/lib/session-client';
import { useTokenStats } from '@/lib/use-live-price';

const WINDOW_LABEL: Record<TokenStatsWindow, string> = { m5: '5M', h1: '1H', h6: '6H', h24: '24H' };
const CHAIN_NAME: Record<TokenInfoChain, string> = { solana: 'Solana', base: 'Base', bnb: 'BNB Chain', robinhood: 'Robinhood Chain' };

/** "2 years ago" / "преди 2 години" — the coin's age in the reader's own language. */
export function relativeAge(createdAtMs: number, locale: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.floor((now - createdAtMs) / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    minutes < 60 ? [minutes, 'minute'] : hours < 48 ? [hours, 'hour'] : days < 60 ? [days, 'day'] : months < 24 ? [months, 'month'] : [Math.floor(months / 12), 'year'];
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-value, unit);
  } catch {
    return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
  }
}

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="kamby-glass rounded-3xl px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-bold text-ink-900">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Two numbers and the bar between them — buys vs sells, buyers vs sellers. */
function SplitRow({ left, right, leftLabel, rightLabel }: { left: number; right: number; leftLabel: string; rightLabel: string }) {
  const total = left + right;
  const leftPct = total > 0 ? (left / total) * 100 : 50;
  return (
    <div>
      <div className="flex items-baseline justify-between font-body text-sm">
        <span>
          <span className="font-semibold tabular-nums text-ink-900">{left.toLocaleString('en-US')}</span> <span className="text-ink-400">{leftLabel}</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums text-ink-900">{right.toLocaleString('en-US')}</span> <span className="text-ink-400">{rightLabel}</span>
        </span>
      </div>
      <div className="mt-1.5 flex h-1.5 gap-1">
        <span className="rounded-full bg-up" style={{ width: `${leftPct}%` }} />
        <span className="flex-1 rounded-full bg-down" />
      </div>
    </div>
  );
}

function StatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-1.5 font-body text-sm">
      <span className="shrink-0 text-ink-400">{label}</span>
      <span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-white/10" />
      <span className="shrink-0 text-right font-semibold tabular-nums text-ink-900">{children}</span>
    </div>
  );
}

/** Holder count and how much the 10 biggest hold — the same (cached) endpoint the Holders tab reads. */
function useHolderSummary(chain: TokenInfoChain, address: string): { count: number | null; top10Pct: number | null } {
  const [summary, setSummary] = useState<{ count: number | null; top10Pct: number | null }>({ count: null, top10Pct: null });
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/v1/market/holders/${chain}/${encodeURIComponent(address)}`)
      .then((res) => (res.ok ? (res.json() as Promise<TokenHolders>) : null))
      .then((body) => {
        if (cancelled || !body) return;
        const top = body.holders.filter((h) => !h.isContract).slice(0, 10);
        setSummary({ count: body.holderCount, top10Pct: top.length > 0 ? top.reduce((sum, h) => sum + h.percent, 0) : null });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chain, address]);
  return summary;
}

/**
 * The coin screen's Info tab (2026-10-13, owner: "we have small info about the coins"): the
 * project's own description and links, trading activity per window, holders, and the coin's
 * stats — one clear card each, like the best trading apps lay it out.
 */
export function CoinInfoTab({
  source,
  chain,
  address,
  chainIdentifier,
  symbol,
  fallback,
}: {
  source: ChartSource;
  chain: TokenInfoChain;
  address: string;
  chainIdentifier: string;
  symbol: string | null;
  fallback?: { marketCapUsd?: number | null; liquidityUsd?: number | null };
}) {
  const tL = useTranslations('labels');
  const locale = useLocale();
  const stats = useTokenStats(source);
  const holders = useHolderSummary(chain, address);
  const [window, setWindow] = useState<TokenStatsWindow>('h1');
  const legacy = window === 'h24' ? stats?.txns24h : window === 'h1' ? stats?.txns1h : undefined;
  const txns: { buys: number; sells: number; buyers: number | null; sellers: number | null } | undefined =
    stats?.txns?.[window] ?? (legacy ? { ...legacy, buyers: null, sellers: null } : undefined);
  const volume = stats?.volumeUsd[window] ?? null;
  const supply = stats?.fdvUsd && stats.priceUsd ? stats.fdvUsd / stats.priceUsd : null;
  const marketCap = stats?.marketCapUsd ?? fallback?.marketCapUsd ?? stats?.fdvUsd ?? null;
  const liquidity = stats?.liquidityUsd ?? fallback?.liquidityUsd ?? null;
  const pad = launchpadFor(chainIdentifier, address);

  return (
    <div className="flex flex-col gap-3">
      <TokenLinks chain={chain} address={address} cardTitle={tL('aboutToken', { symbol: symbol ? cashtag(symbol) : '' })} />

      {stats && (
        <Card
          title={tL('infoTransactions')}
          right={
            <div className="flex gap-0.5">
              {TOKEN_STATS_WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWindow(w)}
                  aria-pressed={w === window}
                  className={cn('rounded-full px-2.5 py-1 font-display text-xs font-semibold', w === window ? 'bg-white/10 text-ink-900' : 'text-ink-400')}
                >
                  {WINDOW_LABEL[w]}
                </button>
              ))}
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            {txns ? <SplitRow left={txns.buys} right={txns.sells} leftLabel={tL('infoBuys')} rightLabel={tL('infoSells')} /> : null}
            {txns && txns.buyers !== null && txns.sellers !== null && (
              <SplitRow left={txns.buyers} right={txns.sellers} leftLabel={tL('infoBuyers')} rightLabel={tL('infoSellers')} />
            )}
            {volume !== null && (
              <p className="flex items-baseline justify-between font-body text-sm">
                <span className="text-ink-400">{tL('infoVolume')}</span>
                <span className="font-semibold tabular-nums text-ink-900">{formatCompactUsd(volume)}</span>
              </p>
            )}
          </div>
        </Card>
      )}

      {(holders.count !== null || holders.top10Pct !== null) && (
        <Card title={tL('infoHolders')}>
          {holders.count !== null && <StatRow label={tL('infoHolderCount')}>{holders.count.toLocaleString('en-US')}</StatRow>}
          {holders.top10Pct !== null && <StatRow label={tL('infoTop10')}>{holders.top10Pct.toFixed(2)}%</StatRow>}
        </Card>
      )}

      <Card title={tL('infoStats', { symbol: symbol ? cashtag(symbol) : '' })}>
        <StatRow label={tL('infoMarketCap')}>{marketCap !== null ? formatCompactUsd(marketCap) : '—'}</StatRow>
        {stats && <StatRow label={tL('infoVolume24h')}>{formatCompactUsd(stats.volumeUsd.h24)}</StatRow>}
        <StatRow label={tL('infoLiquidity')}>{liquidity !== null ? formatCompactUsd(liquidity) : '—'}</StatRow>
        {supply !== null && <StatRow label={tL('infoSupply')}>{formatCompactCount(Math.round(supply))}</StatRow>}
        {stats?.pairCreatedAtMs != null && <StatRow label={tL('infoCreated')}>{relativeAge(stats.pairCreatedAtMs, locale)}</StatRow>}
        {pad && <StatRow label={tL('infoLaunchpad')}>{pad.name}</StatRow>}
        <StatRow label={tL('infoChain')}>{CHAIN_NAME[chain]}</StatRow>
        <div className="flex items-center gap-2 py-1.5 font-body text-sm">
          <span className="shrink-0 text-ink-400">{tL('infoContract')}</span>
          <span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-white/10" />
          <span className="shrink-0 font-mono text-xs text-ink-900">
            {address.slice(0, 4)}…{address.slice(-4)}
          </span>
          <CopyAddressButton address={address} />
        </div>
      </Card>
    </div>
  );
}
