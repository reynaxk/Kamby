'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Candle, LiveRoom, Timeframe } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { CANDLE_REFRESH_MS, evmChartSource, loadCandles, type ChartSource } from '@/lib/chart-data';
import { cashtag, formatPercent, formatPrice } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';
import { useQuickSolanaBuy } from '@/lib/use-quick-solana-buy';
import { KambyChart } from '@/components/terminal/KambyChart';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { TokenAvatar } from '@/components/market/TokenAvatar';

type Coin = NonNullable<LiveRoom['coin']>;
const FRAMES: Timeframe[] = ['1m', '5m', '1H', '1D'];
const AMOUNTS = [5, 10, 25, 50];

function sourceFor(coin: Coin): ChartSource | null {
  if (coin.chainIdentifier === 'solana') return { kind: 'solana', mint: coin.tokenAddress };
  const id = Number(coin.chainIdentifier.split(':')[1]);
  return Number.isFinite(id) && id > 0 ? evmChartSource(coin.tokenAddress, id) : null;
}

/** The coin's latest price (its newest 5m candle), refreshed while the page is visible — the phone's
 *  Trade pill on the stage. */
export function useCoinPrice(coin: Coin | null): { price: number | null; change: number | null } {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  useEffect(() => {
    const source = coin ? sourceFor(coin) : null;
    if (!source) return;
    let cancelled = false;
    const load = (force: boolean) =>
      loadCandles(source, '5m', { force })
        .then((c) => !cancelled && setCandles(c))
        .catch(() => undefined);
    void load(false);
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(true), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin?.chainIdentifier, coin?.tokenAddress]);
  const price = candles?.at(-1)?.close ?? null;
  const first = candles?.[0]?.open ?? null;
  return { price, change: price !== null && first ? ((price - first) / first) * 100 : null };
}

/**
 * Desktop live room (2026-10-30 redesign, owner's concepts): the coin the stream is about, under
 * the stage — its chart and a buy box. Solana buys in one tap (gasless, the ⚡ quick-buy path);
 * Base/BNB/Robinhood open the coin's own screen, where approvals and the fee step live.
 */
export function LiveCoinPanel({ coin }: { coin: Coin }) {
  return (
    <ToastProvider>
      <Inner coin={coin} />
    </ToastProvider>
  );
}

function Inner({ coin }: { coin: Coin }) {
  const t = useTranslations('live');
  const [frame, setFrame] = useState<Timeframe>('5m');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [amount, setAmount] = useState(10);
  const source = sourceFor(coin);
  const solana = source?.kind === 'solana';
  const quick = useQuickSolanaBuy(amount);
  const href = marketHref(coin.chainIdentifier, coin.tokenAddress);
  const label = cashtag(coin.symbol ?? '');

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const load = (force: boolean) =>
      loadCandles(source, frame, { force })
        .then((c) => !cancelled && setCandles(c))
        .catch(() => !cancelled && setCandles((cur) => cur ?? []));
    void load(false);
    const every = CANDLE_REFRESH_MS[frame];
    const timer = every ? setInterval(() => document.visibilityState === 'visible' && void load(true), every) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // The source is derived from the coin's address and chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin.chainIdentifier, coin.tokenAddress, frame]);

  const last = candles?.at(-1)?.close ?? null;
  const first = candles?.[0]?.open ?? null;
  const change = last !== null && first ? ((last - first) / first) * 100 : null;

  return (
    <div className="flex gap-3">
      <section className="min-w-0 flex-[2] rounded-2xl border border-white/10 bg-[#07080B] p-3">
        <div className="flex items-center gap-2.5">
          <TokenAvatar src={coin.logoUrl} seed={coin.tokenAddress} label={coin.symbol} className="h-8 w-8 text-xs" />
          <span className="font-display text-sm font-bold text-white">{label}</span>
          {last !== null && <span className="font-mono text-lg font-bold tabular-nums text-white">{formatPrice(last)}</span>}
          {change !== null && (
            <span className={cn('rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums', change >= 0 ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{formatPercent(change)}</span>
          )}
          <div className="ml-auto flex gap-0.5">
            {FRAMES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFrame(f)}
                className={cn('h-7 rounded-md px-2 font-mono text-[0.7rem]', frame === f ? 'bg-white/[0.08] text-white' : 'text-white/50 hover:text-white')}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 h-[200px]">
          {candles && candles.length > 0 ? (
            <KambyChart candles={candles} />
          ) : (
            <div className={cn('h-full rounded-xl bg-white/[0.03]', candles === null && 'animate-pulse')} />
          )}
        </div>
      </section>

      <section className="flex w-[260px] shrink-0 flex-col gap-2.5 rounded-2xl border border-white/10 bg-[#07080B] p-3">
        <p className="font-display text-sm font-bold text-white">{t('buyCoin', { symbol: label })}</p>
        <div className="grid grid-cols-4 gap-1.5">
          {AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAmount(a)}
              className={cn(
                'h-9 rounded-lg border font-mono text-xs font-bold',
                amount === a ? 'border-accent bg-accent/[0.08] text-accent' : 'border-white/10 bg-white/[0.03] text-white/80',
              )}
            >
              ${a}
            </button>
          ))}
        </div>
        <p className="flex items-center justify-between font-body text-xs text-white/50">
          <span>{t('gas')}</span>
          <span className="font-mono text-up">{t('gasFree')}</span>
        </p>
        {solana ? (
          <button
            type="button"
            disabled={quick.busy === coin.tokenAddress}
            onClick={() => void quick.buy(coin.tokenAddress, label)}
            className="mt-auto h-11 rounded-xl bg-accent font-display text-sm font-black text-black disabled:opacity-50"
          >
            {t('buyAmount', { amount: `$${amount}` })}
          </button>
        ) : (
          href && (
            <Link href={href} className="mt-auto flex h-11 items-center justify-center rounded-xl bg-accent font-display text-sm font-black text-black">
              {t('buyCoin', { symbol: label })}
            </Link>
          )
        )}
        {href && (
          <Link href={href} className="text-center font-display text-xs font-bold text-white/60 hover:text-white">
            {t('openCoin')}
          </Link>
        )}
      </section>
    </div>
  );
}
