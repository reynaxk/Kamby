'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { useTranslations } from 'next-intl';
import { useAccount } from 'wagmi';
import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { ChainBadge } from '@/components/market/ChainBadge';
import { useNativeBalances, type NativeChain } from '@/lib/use-native-balances';
import { useUsdcBalances } from '@/lib/use-usdc-balance';
import { FundModal } from './FundModal';
import { SendModal } from './SendModal';

export const CHAIN_NAME: Record<NativeChain, string> = { solana: 'Solana', base: 'Base', bnb: 'BSC', robinhood: 'Robinhood' };
const PICK_KEY = 'kamby:wallet-chain';
const usd = (n: number | null) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const coin = (n: number | null) => (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: n !== null && n < 1 ? 5 : 3 });
/** A chip's short amount: 0, 0.031, 1.2, 12. */
const short = (n: number | null) => (!n ? '0' : n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 3 : n < 100 ? 2 : 0 }));

/**
 * The wallet as one chain at a time (2026-11-02, native-coin trading — owner: "similar but not
 * copy" of Axiom's wallet): a chip per chain with its coin, the picked chain's coin (and any
 * USDC left there) below, then Deposit / Withdraw on that chain.
 */
export function WalletChains({ className, showTotal = true, actions = true }: { className?: string; showTotal?: boolean; actions?: boolean }) {
  const t = useTranslations('fund');
  const tW = useTranslations('wallet');
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const natives = useNativeBalances(address, wallets[0]?.address);
  const usdc = useUsdcBalances(address, wallets[0]?.address);
  const { hidden } = useBalanceVisibility();
  const [picked, setPicked] = useState<NativeChain | null>(null);
  const [fundOpen, setFundOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PICK_KEY);
      if (saved && saved in CHAIN_NAME) setPicked(saved as NativeChain);
    } catch {
      // Storage blocked — fall back to the richest chain.
    }
  }, []);
  // Until you pick one, the chain holding the most.
  const richest = useMemo(
    () => [...natives.rows].sort((a, b) => (b.usd ?? 0) + (usdc[b.chain] ?? 0) - ((a.usd ?? 0) + (usdc[a.chain] ?? 0)))[0]?.chain ?? 'solana',
    [natives.rows, usdc],
  );
  const chain = picked ?? richest;
  const row = natives.rows.find((r) => r.chain === chain);
  const chainUsdc = usdc[chain] ?? 0;
  const total = natives.totalUsd === null && usdc.total === null ? null : (natives.totalUsd ?? 0) + (usdc.total ?? 0);
  const pick = (c: NativeChain) => {
    setPicked(c);
    try {
      localStorage.setItem(PICK_KEY, c);
    } catch {
      // Storage blocked — the pick lasts for this visit.
    }
  };

  return (
    <div className={className}>
      <div role="tablist" className="grid grid-cols-4 gap-1.5">
        {natives.rows.map((r) => {
          const on = r.chain === chain;
          const has = (r.amount ?? 0) > 0 || (usdc[r.chain] ?? 0) >= 0.01;
          return (
            <button
              key={r.chain}
              type="button"
              role="tab"
              aria-selected={on}
              title={CHAIN_NAME[r.chain]}
              onClick={() => pick(r.chain)}
              className={cn(
                'flex h-9 items-center justify-center gap-1.5 rounded-xl border font-mono text-xs font-semibold tabular-nums transition-colors',
                on ? 'border-accent/50 bg-accent/10 text-ink-900' : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]',
                !on && (has ? 'text-ink-900' : 'text-ink-400'),
              )}
            >
              <ChainBadge chain={r.chain} className="!static !h-4 !w-4 shrink-0 !ring-0" />
              <span className={cn('truncate', hidden && 'select-none blur-sm')}>{short(r.amount)}</span>
            </button>
          );
        })}
      </div>

      {showTotal && (
        <div className="mt-4 flex items-baseline justify-between gap-3">
          <span className="font-body text-xs font-semibold text-ink-400">{t('totalValue')}</span>
          <span className={cn('font-display text-2xl font-bold tabular-nums text-ink-900', hidden && 'select-none blur-sm')}>{usd(total)}</span>
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.02]">
        <div className="flex items-center gap-3 px-4 py-3">
          <ChainBadge chain={chain} className="!static !h-8 !w-8 !ring-0" />
          <span className="min-w-0 flex-1">
            <span className={cn('block font-mono text-base font-bold tabular-nums text-ink-900', hidden && 'select-none blur-sm')}>
              {coin(row?.amount ?? null)} {row?.symbol}
            </span>
            <span className="block font-body text-xs text-ink-400">{CHAIN_NAME[chain]}</span>
          </span>
          <span className={cn('font-mono text-sm tabular-nums text-ink-400', hidden && 'select-none blur-sm')}>{usd(row?.usd ?? null)}</span>
        </div>
        {chainUsdc >= 0.01 && (
          <div className="flex items-center gap-3 border-t border-white/[0.05] px-4 py-2.5">
            <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2775CA] font-display text-xs font-black text-white">$</span>
            <span className="min-w-0 flex-1 font-display text-sm font-bold text-ink-900">{chain === 'robinhood' ? 'USDG' : 'USDC'}</span>
            <span className={cn('font-mono text-sm tabular-nums text-ink-900', hidden && 'select-none blur-sm')}>{usd(chainUsdc)}</span>
          </div>
        )}
      </div>

      {actions && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setFundOpen(true)} className="h-10 rounded-xl bg-accent font-display text-sm font-bold text-accent-ink active:scale-[0.98]">
              {tW('deposit')}
            </button>
            <button type="button" onClick={() => setSendOpen(true)} className="h-10 rounded-xl bg-white/[0.06] font-display text-sm font-bold text-ink-900 hover:bg-white/[0.1] active:scale-[0.98]">
              {tW('withdraw')}
            </button>
          </div>
          <FundModal open={fundOpen} onClose={() => setFundOpen(false)} initialChain={chain} />
          <SendModal open={sendOpen} onClose={() => setSendOpen(false)} initialChain={chain} />
        </>
      )}
    </div>
  );
}
