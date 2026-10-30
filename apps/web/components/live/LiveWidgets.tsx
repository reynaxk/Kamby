'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSignTransaction, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { useAccount } from 'wagmi';
import { getAccount, sendTransaction, switchChain, waitForTransactionReceipt } from 'wagmi/actions';
import { DUEL_LIMITS, LIVE_LIMITS, liveTipFeeUsd, type LiveHost, type LiveTipChain } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { ChainBadge } from '@/components/market/ChainBadge';
import { challengeDuel } from '@/lib/duels-client';
import { friendlyError } from '@/lib/friendly-error';
import { fetchPerpAccount, type PerpPosition } from '@/lib/hyperliquid';
import { prepareLiveTip, submitLiveTip } from '@/lib/live-engine';
import { useUsdcBalances } from '@/lib/use-usdc-balance';
import { wagmiConfig } from '@/lib/wagmi-config';

const POSITIONS_MS = 5_000;

export function compactUsd(v: number): string {
  const a = Math.abs(v);
  return a >= 1_000_000 ? `$${(a / 1_000_000).toFixed(1)}M` : a >= 1_000 ? `$${(a / 1_000).toFixed(1)}K` : `$${a.toFixed(0)}`;
}

/**
 * The host's open perps on Hyperliquid (2026-10-30, live streams) — read straight from Hyperliquid's
 * public API every few seconds while the room is on screen, never through Kamby. A position that
 * opens (or grows) while you watch is passed to `onAlert` so the chat can show it.
 */
export function useHostPerps(address: string | null | undefined, onAlert: (position: PerpPosition) => void): PerpPosition[] | null {
  const [positions, setPositions] = useState<PerpPosition[] | null>(null);
  const seen = useRef<Map<string, number> | null>(null);
  const alert = useRef(onAlert);
  alert.current = onAlert;
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      const account = await fetchPerpAccount(address).catch(() => null);
      if (cancelled || !account) return;
      const before = seen.current;
      if (before) {
        for (const p of account.positions) {
          const was = before.get(p.coin) ?? 0;
          // New, or flipped, or grown by a quarter or more — not every tiny top-up.
          if (Math.sign(was) !== Math.sign(p.size) || Math.abs(p.size) >= Math.abs(was) * 1.25) {
            alert.current(p);
          }
        }
      }
      seen.current = new Map(account.positions.map((p) => [p.coin, p.size]));
      setPositions(account.positions);
    };
    void load();
    const timer = setInterval(() => void load(), POSITIONS_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [address]);
  return positions;
}

/** The host's open perps as a compact strip of chips under the stage. Nothing when there are none. */
export function LivePositions({ positions }: { positions: PerpPosition[] | null }) {
  const t = useTranslations('live');
  if (!positions || positions.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      <span className="shrink-0 font-display text-[0.65rem] font-bold uppercase tracking-wider text-white/45">{t('positions')}</span>
      {positions.map((p) => {
        const long = p.size > 0;
        const up = p.returnOnEquityPct >= 0;
        return (
          <span key={p.coin} className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 font-display text-xs font-bold">
            <span className={long ? 'text-up' : 'text-down'}>{long ? t('long') : t('short')}</span>
            <span className="text-white">{p.coin}</span>
            <span className="text-white/45">{p.leverage}x</span>
            <span className={cn('tabular-nums', up ? 'text-up' : 'text-down')}>
              {up ? '+' : ''}
              {p.returnOnEquityPct.toFixed(1)}%
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** ⚔️ Challenge the host (2026-10-30) — the same no-money duel as in chats: best % PnL wins. */
export function LiveDuelSheet({ open, onClose, host }: { open: boolean; onClose: () => void; host: LiveHost }) {
  const t = useTranslations('live');
  const [minutes, setMinutes] = useState<number>(15);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await challengeDuel(host.username, minutes);
      setSent(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('duelTitle', { name: host.username })} desktop>
      {sent ? (
        <p className="py-6 text-center font-body text-sm text-white/80">{t('duelSent', { name: host.username })}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="font-body text-sm text-white/60">{t('duelBody')}</p>
          <div className="grid grid-cols-4 gap-2">
            {DUEL_LIMITS.minutes.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                className={cn('h-11 rounded-2xl font-display text-sm font-bold', minutes === m ? 'bg-accent text-black' : 'bg-white/[0.06] text-white')}
              >
                {m}m
              </button>
            ))}
          </div>
          {error && <p className="font-body text-xs text-[#FF8FA8]">{error}</p>}
          <button type="button" disabled={busy} onClick={() => void send()} className="h-12 rounded-2xl bg-accent font-display text-sm font-black text-black disabled:opacity-50">
            {t('duelSend')}
          </button>
        </div>
      )}
    </MobileDrawer>
  );
}

const TIP_PRESETS = [5, 10, 25, 50] as const;
const TIP_CHAINS: { chain: LiveTipChain; name: string }[] = [
  { chain: 'solana', name: 'Solana' },
  { chain: 'base', name: 'Base' },
  { chain: 'bnb', name: 'BNB' },
  { chain: 'robinhood', name: 'Robinhood' },
];

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * 💸 Tip the host in USDC (2026-10-30, owner: "$5 minimum, 3% fee, show only the fee's amount").
 * Straight from your wallet to theirs; Kamby's fee goes in the same step and is shown in dollars.
 * Starts on the network where you hold the most USDC.
 */
export function LiveTipSheet({ open, onClose, roomId, host }: { open: boolean; onClose: () => void; roomId: string; host: LiveHost }) {
  const t = useTranslations('live');
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const solanaWallet = wallets[0];
  const { signTransaction } = useSignTransaction();
  const balances = useUsdcBalances(address, solanaWallet?.address);
  const richest = TIP_CHAINS.reduce((best, c) => ((balances[c.chain] ?? 0) > (balances[best.chain] ?? 0) ? c : best), TIP_CHAINS[0]!);
  const [chain, setChain] = useState<LiveTipChain | null>(null);
  const picked = chain ?? richest.chain;
  const [amount, setAmount] = useState<number>(TIP_PRESETS[0]);
  const [step, setStep] = useState<'form' | 'signing' | 'done'>('form');
  const [error, setError] = useState<string | null>(null);
  const fee = liveTipFeeUsd(amount);
  const have = balances[picked];
  const short = have !== null && have < amount + fee;

  async function send() {
    setStep('signing');
    setError(null);
    try {
      const quote = await prepareLiveTip(roomId, picked, amount);
      if (quote.solanaTransactionBase64) {
        if (!solanaWallet) throw new Error(t('walletSettingUp'));
        const { signedTransaction } = await signTransaction({ transaction: base64ToBytes(quote.solanaTransactionBase64), wallet: solanaWallet });
        await submitLiveTip(roomId, quote.tipId, { signedTransactionBase64: bytesToBase64(signedTransaction) });
      } else {
        const txHashes: string[] = [];
        for (const tx of quote.evmTransactions ?? []) {
          const chainId = tx.chainId as 8453 | 56 | 4663;
          if (getAccount(wagmiConfig).chainId !== chainId) await switchChain(wagmiConfig, { chainId });
          const hash = await sendTransaction(wagmiConfig, { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value), chainId });
          await waitForTransactionReceipt(wagmiConfig, { hash, chainId, timeout: 90_000 });
          txHashes.push(hash);
        }
        await submitLiveTip(roomId, quote.tipId, { txHashes });
      }
      setStep('done');
    } catch (err) {
      setError(friendlyError(err));
      setStep('form');
    }
  }

  function close() {
    onClose();
    setStep('form');
    setError(null);
  }

  return (
    <MobileDrawer open={open} onClose={close} title={t('tipTitle', { name: host.username })} desktop>
      {step === 'done' ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="text-4xl" aria-hidden>
            💸
          </span>
          <p className="font-display text-lg font-black text-white">{t('tipSent', { amount: `$${amount.toFixed(2)}`, name: host.username })}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-2">
            {TIP_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className={cn('h-12 rounded-2xl font-display text-base font-black', amount === v ? 'bg-accent text-black' : 'bg-white/[0.06] text-white')}
              >
                ${v}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-1.5 font-body text-xs text-white/50">{t('tipNetwork')}</p>
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
              {TIP_CHAINS.map((c) => (
                <button
                  key={c.chain}
                  type="button"
                  onClick={() => setChain(c.chain)}
                  className={cn('flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3 font-display text-xs font-bold', picked === c.chain ? 'bg-white text-black' : 'bg-white/[0.06] text-white')}
                >
                  <span className="relative h-5 w-5">
                    <ChainBadge chain={c.chain} className="!static !h-5 !w-5 !ring-0" />
                  </span>
                  {c.name}
                  {balances[c.chain] !== null && <span className="tabular-nums opacity-60">${(balances[c.chain] ?? 0).toFixed(2)}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.04] px-4 py-3 font-body text-sm">
            <div className="flex justify-between text-white/60">
              <span>{t('tipTo', { name: host.username })}</span>
              <span className="tabular-nums text-white">${amount.toFixed(2)}</span>
            </div>
            <div className="mt-1 flex justify-between text-white/60">
              <span>{t('tipFee')}</span>
              <span className="tabular-nums text-white">${fee.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-white/10 pt-2 font-display font-bold text-white">
              <span>{t('tipTotal')}</span>
              <span className="tabular-nums">${(amount + fee).toFixed(2)}</span>
            </div>
          </div>
          {short && <p className="font-body text-xs text-[#FACC15]">{t('tipShort')}</p>}
          {error && <p className="font-body text-xs text-[#FF8FA8]">{error}</p>}
          <button
            type="button"
            disabled={step === 'signing' || short}
            onClick={() => void send()}
            className="h-12 rounded-2xl bg-accent font-display text-sm font-black text-black disabled:opacity-50"
          >
            {step === 'signing' ? t('tipSigning') : t('tipSend', { amount: `$${amount.toFixed(2)}` })}
          </button>
          <p className="text-center font-body text-[0.7rem] text-white/40">{t('tipMin', { min: `$${LIVE_LIMITS.tipMinUsd}` })}</p>
        </div>
      )}
    </MobileDrawer>
  );
}
