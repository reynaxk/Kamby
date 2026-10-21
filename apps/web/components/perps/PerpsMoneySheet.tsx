'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { friendlyError } from '@/lib/friendly-error';
import { MIN_DEPOSIT_USD, MIN_WITHDRAW_USD, PERPS_SOURCES, quoteDeposit, quoteWithdraw, runDeposit, runWithdraw } from '@/lib/hyperliquid';
import { useUsdcBalances } from '@/lib/use-usdc-balance';
import { usd } from './usePerps';

type Mode = 'deposit' | 'withdraw';

/**
 * Money in and out of Perps (2026-10-21): Kamby's USDC (Base or BNB, whichever holds more) →
 * Hyperliquid perps USDC, or back to Base — both through Relay. Shows what actually lands and
 * the network fee before anything is signed.
 */
export function PerpsMoneySheet({ mode, open, onClose, address, withdrawableUsd, onDone }: { mode: Mode; open: boolean; onClose: () => void; address: string; withdrawableUsd: number; onDone: () => void }) {
  const t = useTranslations('perps');
  const balances = useUsdcBalances(address, undefined);
  const [text, setText] = useState('');
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof quoteDeposit>> | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const source = [...PERPS_SOURCES].sort((a, b) => (balances[b.slug] ?? 0) - (balances[a.slug] ?? 0))[0]!;
  const available = mode === 'deposit' ? (balances[source.slug] ?? 0) : withdrawableUsd;
  const amount = Number(text) || 0;
  const min = mode === 'deposit' ? MIN_DEPOSIT_USD : MIN_WITHDRAW_USD;
  const tooSmall = amount > 0 && amount < min;
  const tooBig = amount > available + 1e-9;

  useEffect(() => {
    if (!open) {
      setText('');
      setQuote(null);
      setError(null);
      setDone(false);
      setBusy(false);
    }
  }, [open]);

  // Price it as they type (debounced).
  useEffect(() => {
    setQuote(null);
    if (!open || !(amount >= min) || tooBig) return;
    setQuoting(true);
    const timer = setTimeout(() => {
      void (mode === 'deposit' ? quoteDeposit(address, source, amount) : quoteWithdraw(address, amount))
        .then(setQuote)
        .catch((e: unknown) => setError(friendlyError(e)))
        .finally(() => setQuoting(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [open, amount, mode, address, source.slug, tooBig]); // eslint-disable-line react-hooks/exhaustive-deps

  const youGet = quote ? Number(quote.details.currencyOut.amountFormatted) : null;

  async function go() {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'deposit') await runDeposit(quote);
      else await runWithdraw(quote);
      setDone(true);
      onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MobileDrawer open={open} onClose={onClose} title={mode === 'deposit' ? t('depositTitle') : t('withdrawTitle')} desktop>
      {done ? (
        <div className="flex flex-col items-center py-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 5 5L20 7" />
            </svg>
          </span>
          <p className="mt-3 font-display text-lg font-bold text-ink-900">{t('done')}</p>
          <p className="mt-1 font-body text-sm text-ink-400">{youGet !== null ? usd(youGet) : ''}</p>
          <button type="button" onClick={onClose} className="mt-5 h-12 w-full rounded-2xl bg-white/[0.08] font-display text-sm font-bold text-ink-900">
            OK
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-center font-body text-xs text-ink-400">
            {mode === 'deposit' ? `${t('depositFrom')} ${source.slug === 'bnb' ? 'BNB Chain' : 'Base'} · ${usd(available)}` : `${t('withdrawTo')} · ${usd(available)}`}
          </p>
          <div className="flex items-baseline justify-center py-2 font-display font-bold text-ink-900">
            <span className={cn('text-5xl', !text && 'text-ink-400')}>$</span>
            <input
              inputMode="decimal"
              placeholder="0"
              value={text}
              aria-label={mode === 'deposit' ? t('deposit') : t('withdraw')}
              onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setText(e.target.value)}
              style={{ width: `${Math.max(1, text.length) + 0.15}ch` }}
              className="bg-transparent text-center text-5xl tabular-nums placeholder:text-ink-400 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[0.25, 0.5, 1].map((f) => (
              <button
                key={f}
                type="button"
                disabled={!(available > 0)}
                onClick={() => setText((Math.floor(available * f * 100) / 100).toFixed(2))}
                className="rounded-2xl bg-white/[0.05] py-2.5 font-display text-sm font-bold text-ink-900 disabled:opacity-40"
              >
                {f === 1 ? 'Max' : `${f * 100}%`}
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3 font-body text-sm">
            <div className="flex justify-between">
              <span className="text-ink-400">{t('youGet')}</span>
              <span className="font-display font-bold tabular-nums text-ink-900">{quoting ? '…' : youGet !== null ? usd(youGet) : '—'}</span>
            </div>
            <div className="mt-2 flex justify-between">
              <span className="text-ink-400">{t('networkFee')}</span>
              <span className="tabular-nums text-ink-600">{youGet !== null ? usd(Math.max(0, amount - youGet)) : '—'}</span>
            </div>
          </div>
          {(tooSmall || tooBig || error) && (
            <p className="text-center font-body text-xs font-semibold text-down">{tooBig ? t('notEnough') : tooSmall ? t(mode === 'deposit' ? 'minDeposit' : 'minWithdraw', { min }) : error}</p>
          )}
          <button
            type="button"
            disabled={!quote || busy || tooBig || tooSmall}
            onClick={() => void go()}
            className="h-14 w-full rounded-2xl bg-accent font-display text-base font-black text-black transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? t('moving') : mode === 'deposit' ? t('deposit') : t('withdraw')}
          </button>
        </div>
      )}
    </MobileDrawer>
  );
}
