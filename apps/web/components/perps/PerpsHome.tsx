'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrivy } from '@privy-io/react-auth';
import { cn } from '@kamby/ui';
import { formatCompactUsd, formatPercent } from '@/lib/format';
import { PerpsMoneySheet } from './PerpsMoneySheet';
import { perpPx, usd, usePerpAccount, usePerpMarkets } from './usePerps';

/** A coin's mark for perps: Hyperliquid has no logos in its API, so a clean letter tile. */
export function PerpMark({ coin, className }: { coin: string; className?: string }) {
  const seed = Array.from(coin).reduce((n, c) => n * 31 + c.charCodeAt(0), 7);
  const hue = Math.abs(seed) % 360;
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-full font-display font-black text-white', className)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 80% 52%), hsl(${(hue + 50) % 360} 75% 36%))` }}
    >
      {coin.replace(/^k/, '').slice(0, 1)}
    </span>
  );
}

/** Perps balance, Deposit and Withdraw — on the Perps home and above each market. */
export function PerpsAccountBar() {
  const t = useTranslations('perps');
  const { authenticated, login } = usePrivy();
  const { address, account, refresh } = usePerpAccount();
  const [sheet, setSheet] = useState<'deposit' | 'withdraw' | null>(null);
  return (
    <section className="rounded-3xl border border-white/[0.07] bg-surface p-4">
      <p className="font-body text-xs text-ink-400">{t('balance')}</p>
      <p className="mt-0.5 font-display text-3xl font-extrabold tabular-nums text-ink-900">{account ? usd(account.accountValueUsd) : authenticated ? '…' : '$0.00'}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => (authenticated && address ? setSheet('deposit') : login())}
          className="h-11 rounded-2xl bg-accent font-display text-sm font-bold text-black transition-transform active:scale-[0.98]"
        >
          {t('deposit')}
        </button>
        <button
          type="button"
          disabled={!account || account.withdrawableUsd <= 0}
          onClick={() => setSheet('withdraw')}
          className="h-11 rounded-2xl border border-white/10 bg-white/[0.04] font-display text-sm font-bold text-ink-900 transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {t('withdraw')}
        </button>
      </div>
      {address && sheet && (
        <PerpsMoneySheet mode={sheet} open onClose={() => setSheet(null)} address={address} withdrawableUsd={account?.withdrawableUsd ?? 0} onDone={refresh} />
      )}
    </section>
  );
}

/**
 * ⚡ Perps home (2026-10-21): your Perps balance, your open positions, then every Hyperliquid
 * market — busiest first, searchable — with price, 24h move and max leverage.
 */
export function PerpsHome() {
  const t = useTranslations('perps');
  const markets = usePerpMarkets();
  const { account } = usePerpAccount();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const query = q.trim().toUpperCase();
    return (markets ?? []).filter((m) => !query || m.coin.toUpperCase().includes(query)).slice(0, 80);
  }, [markets, q]);
  const byCoin = new Map((markets ?? []).map((m) => [m.coin, m]));

  return (
    <div className="space-y-4">
      <PerpsAccountBar />

      {account && account.positions.length > 0 && (
        <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface">
          <h2 className="px-4 pt-4 font-display text-sm font-bold text-ink-900">{t('positions')}</h2>
          <ul className="mt-1 divide-y divide-white/[0.05]">
            {account.positions.map((p) => {
              const up = p.unrealizedPnlUsd >= 0;
              return (
                <li key={p.coin}>
                  <Link href={`/perps/${encodeURIComponent(p.coin)}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
                    <PerpMark coin={p.coin} className="h-10 w-10 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-sm font-bold text-ink-900">
                        {p.coin} <span className={cn('ml-1 rounded-md px-1.5 py-0.5 text-[0.65rem]', p.size > 0 ? 'bg-up/15 text-up' : 'bg-down/15 text-down')}>{p.size > 0 ? t('long') : t('short')} {p.leverage}×</span>
                      </span>
                      <span className="block font-body text-xs text-ink-400">{usd(p.positionValueUsd)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn('block font-display text-sm font-bold tabular-nums', up ? 'text-up' : 'text-down')}>
                        {up ? '+' : '−'}
                        {usd(Math.abs(p.unrealizedPnlUsd))}
                      </span>
                      <span className={cn('block font-body text-xs tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(p.returnOnEquityPct)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface">
        <div className="flex items-center gap-3 px-4 pt-4">
          <h2 className="flex-1 font-display text-sm font-bold text-ink-900">{t('markets')}</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-9 w-40 rounded-xl border border-white/10 bg-white/[0.03] px-3 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent/60 focus:outline-none"
          />
        </div>
        {markets === null ? (
          <div className="space-y-2 p-4" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-2xl bg-white/[0.04]" />
            ))}
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.05]">
            {list.map((m) => {
              const up = m.change24hPct >= 0;
              const held = byCoin.has(m.coin) && account?.positions.some((p) => p.coin === m.coin);
              return (
                <li key={m.coin}>
                  <Link href={`/perps/${encodeURIComponent(m.coin)}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
                    <PerpMark coin={m.coin} className="h-10 w-10 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-display text-sm font-bold text-ink-900">
                        {m.coin}
                        <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[0.65rem] font-bold text-ink-600">{m.maxLeverage}×</span>
                        {held && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
                      </span>
                      <span className="block font-body text-xs text-ink-400">
                        {t('vol')} {formatCompactUsd(m.volume24hUsd)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-body text-sm font-semibold tabular-nums text-ink-900">${perpPx(m.markPx)}</span>
                      <span className={cn('block font-body text-xs font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(m.change24hPct)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
