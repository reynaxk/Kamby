'use client';

import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { cn } from '@kamby/ui';
import { useAccount } from 'wagmi';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { useUsdcBalances } from '@/lib/use-usdc-balance';
import { useTranslations } from 'next-intl';


// $0.00 until a balance is known — never a dash (owner 2026-10-11).
const usd = (n: number | null) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The user's USDC, chain by chain (2026-10-05: a Solana-funded user tried a Base coin and got
 * "you have $0.00" — the header shows one total, but each chain's USDC is separate and coins on
 * that chain trade with it). Total, a split bar, one row per chain with a Deposit pill where
 * it's empty.
 */
export function ChainBalancesCard() {
  const tU = useTranslations('ui');
  const tL = useTranslations('labels');
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const balances = useUsdcBalances(address, wallets[0]?.address);
  const { hidden } = useBalanceVisibility();

  // One USDC (owner + dad, 2026-10-13): no per-chain list — one balance. The Deposit button sits
  // under this card (2026-10-29: it was here too, twice on the same screen).
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-400">{tU('yourUsdc_8d00')}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className={cn('font-display text-3xl font-extrabold tabular-nums text-ink-900', hidden && 'select-none blur-sm')}>{usd(balances.total)}</p>
      </div>
      <p className="mt-3 font-body text-xs leading-relaxed text-ink-400">{tL('oneUsdcNote')}</p>
    </div>
  );
}
