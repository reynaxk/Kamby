'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrivy } from '@privy-io/react-auth';
import type { Candle } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { KambyChart } from '@/components/terminal/KambyChart';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { useTerminalToast } from '@/components/terminal/ToastProvider';
import { friendlyError } from '@/lib/friendly-error';
import { formatCompactUsd, formatPercent } from '@/lib/format';
import { BUILDER_FEE_TENTHS_BP, closePerp, enableTrading, estimateLiqPx, fetchPerpCandles, HL_TAKER_FEE, openPerp, storedAgent, type PerpInterval } from '@/lib/hyperliquid';
import { PerpMark, PerpsAccountBar } from './PerpsHome';
import { acceptRisk, perpPx, riskAccepted, usd, usePerpAccount, usePerpMarkets } from './usePerps';

const INTERVALS: PerpInterval[] = ['5m', '15m', '1h', '4h', '1d'];
const FEE_RATE = HL_TAKER_FEE + BUILDER_FEE_TENTHS_BP / 100_000;

/**
 * ⚡ One perp market (2026-10-21): its chart, then a trade panel that's a single tap once set up —
 * Long or Short, how much margin, how much leverage (up to the market's max), and the position
 * size, rough liquidation price and fee before the tap. Your open position here sits under it
 * with Close. First-time steps (sign in → deposit → risk note → turn on 1-tap) appear in order.
 */
export function PerpsCoinScreen({ coin }: { coin: string }) {
  const t = useTranslations('perps');
  const toast = useTerminalToast();
  const { authenticated, login } = usePrivy();
  const markets = usePerpMarkets();
  const { address, account, refresh } = usePerpAccount();
  const market = markets?.find((m) => m.coin === coin) ?? null;
  const position = account?.positions.find((p) => p.coin === coin) ?? null;

  const [interval, setIntervalPick] = useState<PerpInterval>('15m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLong, setIsLong] = useState(true);
  const [text, setText] = useState('');
  const [leverage, setLeverage] = useState(5);
  const [busy, setBusy] = useState<'open' | 'close' | 'enable' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskTick, setRiskTick] = useState(false);
  const [enableOpen, setEnableOpen] = useState(false);
  const [hasAgent, setHasAgent] = useState(false);

  useEffect(() => setHasAgent(Boolean(address && storedAgent(address))), [address]);
  useEffect(() => {
    if (market) setLeverage((l) => Math.min(l, market.maxLeverage));
  }, [market?.maxLeverage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void fetchPerpCandles(coin, interval)
        .then((c) => !cancelled && setCandles(c))
        .catch(() => undefined);
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [coin, interval]);

  const margin = Number(text) || 0;
  const available = account?.withdrawableUsd ?? 0;
  const notional = margin * leverage;
  const liq = market && margin > 0 ? estimateLiqPx(market.markPx, leverage, isLong, market.maxLeverage) : null;
  const fee = notional * FEE_RATE;
  const tooBig = margin > available + 1e-9;
  const levChips = market ? [...new Set([2, 5, 10, 20, market.maxLeverage].filter((x) => x <= market.maxLeverage))] : [];

  async function trade() {
    if (!market || !address) return;
    if (!riskAccepted()) return setRiskOpen(true);
    if (!storedAgent(address)) return setEnableOpen(true);
    setBusy('open');
    setError(null);
    try {
      await openPerp(address, market, isLong, margin, leverage);
      toast.push({ variant: 'success', title: t('opened') });
      setText('');
      refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function enable() {
    if (!address) return;
    setBusy('enable');
    setError(null);
    try {
      await enableTrading(address);
      setHasAgent(true);
      setEnableOpen(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    if (!market || !address || !position) return;
    setBusy('close');
    setError(null);
    try {
      await closePerp(address, market, position);
      refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  const up = (market?.change24hPct ?? 0) >= 0;
  const needDeposit = authenticated && account !== null && account.accountValueUsd <= 0;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Link href="/perps" aria-label="Perps" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-600 active:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <PerpMark coin={coin} className="h-11 w-11 text-base" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold text-ink-900">
            {coin}-PERP <span className="ml-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-xs font-bold text-ink-600">{t('upTo', { lev: market?.maxLeverage ?? '…' })}</span>
          </p>
          <p className="font-body text-xs text-ink-400">
            {t('funding')} {market ? `${(market.funding * 100).toFixed(4)}%/h` : '—'} · {t('oi')} {market ? formatCompactUsd(market.openInterestUsd) : '—'}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-bold tabular-nums text-ink-900">{market ? `$${perpPx(market.markPx)}` : '—'}</p>
          <p className={cn('font-body text-xs font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>{market ? formatPercent(market.change24hPct) : ''}</p>
        </div>
      </header>

      <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface">
        <div className="h-[300px] md:h-[380px]">{candles.length > 1 ? <KambyChart candles={candles} entryPrice={position?.entryPx ?? null} /> : <div className="h-full animate-pulse bg-white/[0.02]" />}</div>
        <div className="flex gap-1 border-t border-white/[0.05] p-2">
          {INTERVALS.map((i) => (
            <button key={i} type="button" onClick={() => setIntervalPick(i)} className={cn('flex-1 rounded-xl py-1.5 font-display text-xs font-bold', interval === i ? 'bg-white/10 text-ink-900' : 'text-ink-400')}>
              {i}
            </button>
          ))}
        </div>
      </section>

      {position && market && (
        <section className="rounded-3xl border border-white/[0.07] bg-surface p-4">
          <div className="flex items-center justify-between">
            <p className="font-display text-sm font-bold text-ink-900">
              <span className={cn('mr-1.5 rounded-md px-1.5 py-0.5 text-xs', position.size > 0 ? 'bg-up/15 text-up' : 'bg-down/15 text-down')}>
                {position.size > 0 ? t('long') : t('short')} {position.leverage}×
              </span>
              {usd(position.positionValueUsd)}
            </p>
            <p className={cn('font-display text-base font-bold tabular-nums', position.unrealizedPnlUsd >= 0 ? 'text-up' : 'text-down')}>
              {position.unrealizedPnlUsd >= 0 ? '+' : '−'}
              {usd(Math.abs(position.unrealizedPnlUsd))} <span className="text-xs">({formatPercent(position.returnOnEquityPct)})</span>
            </p>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 font-body text-xs">
            <p className="text-ink-400">
              {t('entry')} <span className="font-semibold text-ink-900">${perpPx(position.entryPx)}</span>
            </p>
            <p className="text-right text-ink-400">
              {t('liq')} <span className="font-semibold text-down">{position.liquidationPx ? `$${perpPx(position.liquidationPx)}` : '—'}</span>
            </p>
          </div>
          <button type="button" disabled={busy !== null || !hasAgent} onClick={() => void close()} className="mt-3 h-11 w-full rounded-2xl border border-white/10 bg-white/[0.05] font-display text-sm font-bold text-ink-900 active:scale-[0.98] disabled:opacity-40">
            {busy === 'close' ? t('closing') : t('close')}
          </button>
        </section>
      )}

      <section className="rounded-3xl border border-white/[0.07] bg-surface p-4">
        <div className="flex rounded-2xl bg-white/[0.04] p-1">
          {[true, false].map((l) => (
            <button
              key={String(l)}
              type="button"
              onClick={() => setIsLong(l)}
              className={cn('flex-1 rounded-xl py-2.5 font-display text-sm font-black transition-colors', isLong === l ? (l ? 'bg-up text-black' : 'bg-down text-white') : 'text-ink-400')}
            >
              {l ? t('long') : t('short')}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between font-body text-xs text-ink-400">
          <span>{t('margin')}</span>
          <span>
            {t('balance')} {usd(available)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-center py-1 font-display font-bold text-ink-900">
          <span className={cn('text-4xl', !text && 'text-ink-400')}>$</span>
          <input
            inputMode="decimal"
            placeholder="0"
            value={text}
            aria-label={t('margin')}
            onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setText(e.target.value)}
            style={{ width: `${Math.max(1, text.length) + 0.15}ch` }}
            className="bg-transparent text-center text-4xl tabular-nums placeholder:text-ink-400 focus:outline-none"
          />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[0.25, 0.5, 1].map((f) => (
            <button key={f} type="button" disabled={!(available > 0)} onClick={() => setText((Math.floor(available * f * 100) / 100).toFixed(2))} className="rounded-2xl bg-white/[0.05] py-2 font-display text-sm font-bold text-ink-900 disabled:opacity-40">
              {f === 1 ? 'Max' : `${f * 100}%`}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="font-body text-xs text-ink-400">{t('leverage')}</span>
          <span className="font-display text-lg font-black tabular-nums text-ink-900">{leverage}×</span>
        </div>
        <input
          type="range"
          min={1}
          max={market?.maxLeverage ?? 10}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          aria-label={t('leverage')}
          className="mt-2 w-full accent-[#00FF87]"
        />
        <div className="mt-2 flex gap-1.5">
          {levChips.map((x) => (
            <button key={x} type="button" onClick={() => setLeverage(x)} className={cn('flex-1 rounded-xl py-1.5 font-display text-xs font-bold', leverage === x ? 'bg-white/10 text-ink-900' : 'bg-white/[0.03] text-ink-400')}>
              {x}×
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3 font-body text-sm">
          <div className="flex justify-between">
            <span className="text-ink-400">{t('size')}</span>
            <span className="font-display font-bold tabular-nums text-ink-900">{margin > 0 ? usd(notional) : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-400">{t('liq')}</span>
            <span className="tabular-nums text-down">{liq ? `≈ $${perpPx(liq)}` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-400">{t('fee')}</span>
            <span className="tabular-nums text-ink-600">{margin > 0 ? usd(fee) : '—'}</span>
          </div>
        </div>

        {error && <p className="mt-3 text-center font-body text-xs font-semibold text-down">{error}</p>}
        {needDeposit && <p className="mt-3 text-center font-body text-xs text-ink-400">{t('needDeposit')}</p>}

        <button
          type="button"
          disabled={authenticated && (busy !== null || !market || !(margin > 0) || tooBig)}
          onClick={() => (authenticated ? void trade() : login())}
          className={cn('mt-4 h-14 w-full rounded-2xl font-display text-base font-black transition-transform active:scale-[0.98] disabled:opacity-40', isLong ? 'bg-up text-black' : 'bg-down text-white')}
        >
          {busy === 'open' ? t('placing') : tooBig ? t('notEnough') : isLong ? t('openLong', { coin, lev: leverage }) : t('openShort', { coin, lev: leverage })}
        </button>
      </section>

      <PerpsAccountBar />

      {/* First trade: the risk note */}
      <MobileDrawer open={riskOpen} onClose={() => setRiskOpen(false)} title={t('riskTitle')} desktop>
        <p className="font-body text-sm leading-relaxed text-ink-600">{t('riskBody')}</p>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <input type="checkbox" checked={riskTick} onChange={(e) => setRiskTick(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#00FF87]" />
          <span className="font-body text-sm text-ink-900">{t('riskAgree')}</span>
        </label>
        <button
          type="button"
          disabled={!riskTick}
          onClick={() => {
            acceptRisk();
            setRiskOpen(false);
            void trade();
          }}
          className="mt-4 h-12 w-full rounded-2xl bg-accent font-display text-sm font-black text-black disabled:opacity-40"
        >
          {t('riskOk')}
        </button>
      </MobileDrawer>

      {/* First trade: turn on 1-tap (two gas-free signatures) */}
      <MobileDrawer open={enableOpen} onClose={() => setEnableOpen(false)} title={t('enableTitle')} desktop>
        <p className="font-body text-sm leading-relaxed text-ink-600">{t('enableBody')}</p>
        {error && <p className="mt-3 font-body text-xs font-semibold text-down">{error}</p>}
        <button type="button" disabled={busy === 'enable'} onClick={() => void enable()} className="mt-4 h-12 w-full rounded-2xl bg-accent font-display text-sm font-black text-black disabled:opacity-40">
          {busy === 'enable' ? t('enabling') : t('enable')}
        </button>
      </MobileDrawer>
    </div>
  );
}
