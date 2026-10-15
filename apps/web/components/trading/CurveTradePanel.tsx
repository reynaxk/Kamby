'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { useAccount } from 'wagmi';
import { getAccount, sendTransaction, switchChain, waitForTransactionReceipt } from 'wagmi/actions';
import { Loader2 } from 'lucide-react';
import type { LaunchEvmTx } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MoveNote, isMoveBusy } from '@/components/trading/CrossChainMove';
import { TradeSuccess } from '@/components/trading/TradeSuccess';
import { useWalletVerification } from '@/hooks/useWalletVerification';
import { fetchCurveState, nextCurveStep, startCurveTrade, type CurveState } from '@/lib/fourmeme-client';
import { formatTokenAmount } from '@/lib/format';
import { notifyTradeConfirmed, useMyPosition } from '@/lib/my-positions';
import { useCrossChainFunding } from '@/lib/use-cross-chain-funding';
import { wagmiConfig } from '@/lib/wagmi-config';

const BUY_PRESETS = [5, 10, 25, 50];
const SELL_PRESETS = [25, 50, 100];

/** Sends each transaction of a step from the wallet, in order, waiting for each. */
async function sendAll(txs: LaunchEvmTx[], onProgress: (i: number) => void): Promise<string[]> {
  const hashes: string[] = [];
  for (const [i, tx] of txs.entries()) {
    onProgress(i);
    const chainId = tx.chainId as 56;
    if (getAccount(wagmiConfig).chainId !== chainId) await switchChain(wagmiConfig, { chainId });
    const hash = await sendTransaction(wagmiConfig, { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value), chainId });
    await waitForTransactionReceipt(wagmiConfig, { hash, chainId, timeout: 90_000 });
    hashes.push(hash);
  }
  return hashes;
}

/**
 * Trading a Four.meme coin that's still on its bonding curve (2026-10-15) — no aggregator routes
 * those, so Kamby does it in steps, all in USDC: a buy is the fee, USDC → BNB, then the curve buy; a
 * sell is the curve sell, then BNB → USDC and the fee (see FourMemeCurveService). The bar shows how
 * close the coin is to graduating to PancakeSwap, after which it trades like any other coin.
 */
export function CurveTradePanel({ tokenAddress, tokenSymbol, initialSide = 'BUY', state: initialState }: { tokenAddress: string; tokenSymbol: string | null; initialSide?: 'BUY' | 'SELL'; state?: CurveState | null }) {
  const t = useTranslations('curve');
  const tAuth = useTranslations('auth');
  const { ready, authenticated, login } = usePrivy();
  const { address } = useAccount();
  const verification = useWalletVerification();
  const position = useMyPosition(tokenAddress);
  const [state, setState] = useState<CurveState | null>(initialState ?? null);
  const [side, setSide] = useState<'BUY' | 'SELL'>(initialSide);
  const [usd, setUsd] = useState('10');
  const [pct, setPct] = useState(100);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => fetchCurveState(tokenAddress).then((s) => live && setState(s)).catch(() => undefined);
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [tokenAddress]);

  const amountUsd = Number(usd) || 0;
  const funding = useCrossChainFunding('bnb', side === 'BUY' && amountUsd > 0 && !busy ? amountUsd : null);
  const short = side === 'BUY' && funding.balances.bnb !== null && funding.balances.bnb < amountUsd;
  const needsMove = short && funding.canCover && funding.stage !== 'done';
  const held = position?.quantity ?? 0;
  const symbol = tokenSymbol ?? '';

  async function run() {
    if (!address) return;
    setError(null);
    setDone(null);
    try {
      if (needsMove) await funding.move();
      setBusy(t('confirmInWallet'));
      const amountRaw = side === 'SELL' ? BigInt(Math.floor(held * (pct / 100) * 1e6)) * 10n ** 12n : undefined; // 18-decimal coins
      let step = await startCurveTrade({ side, walletAddress: address, token: tokenAddress, amountUsd: side === 'BUY' ? amountUsd : undefined, amountRaw: amountRaw?.toString() });
      while (step.transactions) {
        const hashes = await sendAll(step.transactions, (i) => setBusy(t('confirmStep', { n: String(i + 1), of: String(step.transactions!.length) })));
        setBusy(t('working'));
        step = await nextCurveStep(step.id, hashes);
      }
      notifyTradeConfirmed();
      setDone(side === 'BUY' ? t('bought', { amount: formatTokenAmount(Number(step.done?.tokensRaw ?? 0) / 1e18), symbol }) : t('sold', { amount: (Number(step.done?.usdcRaw ?? 0) / 1e18).toFixed(2) }));
    } catch (e) {
      setError((e as Error).message || t('failed'));
    } finally {
      setBusy(null);
    }
  }

  if (state?.graduated) return <p className="font-body text-sm text-ink-400">{t('graduated')}</p>;

  return (
    <div className="space-y-3">
      {state && (
        <div>
          <div className="flex items-center justify-between font-body text-xs text-ink-400">
            <span>{t('onCurve')}</span>
            <span className="tabular-nums">{state.progressPct.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, state.progressPct)}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-raised p-1">
        {(['BUY', 'SELL'] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={Boolean(busy)}
            onClick={() => setSide(s)}
            className={cn('rounded-lg py-2 font-display text-sm font-bold', side === s ? (s === 'BUY' ? 'bg-accent text-black' : 'bg-down text-white') : 'text-ink-400')}
          >
            {s === 'BUY' ? t('buy') : t('sell')}
          </button>
        ))}
      </div>

      {side === 'BUY' ? (
        <>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-lg font-bold text-ink-400">$</span>
            <input
              value={usd}
              onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))}
              inputMode="decimal"
              aria-label={t('amount')}
              disabled={Boolean(busy)}
              className="h-12 w-full rounded-xl bg-surface-raised pl-8 pr-4 font-display text-lg font-bold tabular-nums text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent/60"
            />
          </div>
          <div className="flex gap-2">
            {BUY_PRESETS.map((p) => (
              <button key={p} type="button" disabled={Boolean(busy)} onClick={() => setUsd(String(p))} className={cn('h-8 flex-1 rounded-full font-display text-xs font-bold', Number(usd) === p ? 'bg-white/10 text-ink-900' : 'bg-surface-raised text-ink-400')}>
                ${p}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="font-body text-sm text-ink-400">
            {t('youHold', { amount: formatTokenAmount(held), symbol })}
          </p>
          <div className="flex gap-2">
            {SELL_PRESETS.map((p) => (
              <button key={p} type="button" disabled={Boolean(busy)} onClick={() => setPct(p)} className={cn('h-9 flex-1 rounded-full font-display text-sm font-bold', pct === p ? 'bg-white/10 text-ink-900' : 'bg-surface-raised text-ink-400')}>
                {p}%
              </button>
            ))}
          </div>
        </>
      )}

      {needsMove && <MoveNote funding={funding} target="bnb" />}
      {error && <p className="text-center font-body text-xs font-semibold text-down">{error}</p>}
      {done && <TradeSuccess title={done} />}

      {!ready ? null : !authenticated ? (
        <button type="button" onClick={() => login()} className="h-12 w-full rounded-2xl bg-accent font-display text-base font-bold text-black">
          {tAuth('signIn')}
        </button>
      ) : !address || verification.status !== 'verified' ? (
        <p className="text-center font-body text-sm text-ink-400">{t('settingUp')}</p>
      ) : (
        <button
          type="button"
          disabled={Boolean(busy) || isMoveBusy(funding) || (side === 'BUY' ? amountUsd < 2 || (short && !funding.canCover) : !(held > 0))}
          onClick={() => void run()}
          className={cn('flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-base font-bold disabled:opacity-40', side === 'BUY' ? 'bg-accent text-black' : 'bg-down text-white')}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {busy}
            </>
          ) : side === 'BUY' ? (
            t('buyButton', { symbol, amount: amountUsd.toFixed(2) })
          ) : (
            t('sellButton', { symbol, pct: String(pct) })
          )}
        </button>
      )}
      <p className="text-center font-body text-[0.7rem] text-ink-400">{t('note')}</p>
    </div>
  );
}
