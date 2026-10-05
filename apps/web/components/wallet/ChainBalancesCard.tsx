'use client';

import { useState } from 'react';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { cn } from '@kamby/ui';
import { useAccount } from 'wagmi';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';
import { useUsdcBalances } from '@/lib/use-usdc-balance';
import { FundModal } from './FundModal';

const CHAINS: { chain: BadgeChain; name: string; color: string }[] = [
  { chain: 'solana', name: 'Solana', color: '#9945FF' },
  { chain: 'base', name: 'Base', color: '#2F6BFF' },
  { chain: 'bnb', name: 'BNB Chain', color: '#F3BA2F' },
];

const usd = (n: number | null) => (n === null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * The user's USDC, chain by chain (2026-10-05: a Solana-funded user tried a Base coin and got
 * "you have $0.00" — the header shows one total, but each chain's USDC is separate and coins on
 * that chain trade with it). Total, a split bar, one row per chain with a Deposit pill where
 * it's empty.
 */
export function ChainBalancesCard() {
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const balances = useUsdcBalances(address, wallets[0]?.address);
  const { hidden } = useBalanceVisibility();
  const [depositChain, setDepositChain] = useState<BadgeChain | null>(null);
  const total = balances.total ?? 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-400">Your USDC</p>
      <p className={cn('mt-1 font-display text-3xl font-extrabold tabular-nums text-ink-900', hidden && 'select-none blur-sm')}>{usd(balances.total)}</p>

      {/* Where it sits */}
      <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-white/5">
        {total > 0 &&
          CHAINS.map(({ chain, color }) => {
            const part = balances[chain] ?? 0;
            return part > 0 ? <span key={chain} style={{ width: `${(part / total) * 100}%`, background: color }} /> : null;
          })}
      </div>

      <ul className="mt-4 divide-y divide-white/5">
        {CHAINS.map(({ chain, name }) => {
          const amount = balances[chain];
          const empty = amount !== null && amount < 0.01;
          return (
            <li key={chain} className="flex items-center gap-3 py-2.5">
              <span className="relative h-6 w-6 shrink-0">
                <ChainBadge chain={chain} className="!static !h-6 !w-6 !ring-0" />
              </span>
              <span className="flex-1 font-display text-sm font-semibold text-ink-900">{name}</span>
              <span className={cn('font-mono text-sm tabular-nums', empty ? 'text-ink-400' : 'text-ink-900', hidden && 'select-none blur-sm')}>{usd(amount)}</span>
              {/* Every chain can be topped up; an empty one gets the bright pill. */}
              <button
                type="button"
                onClick={() => setDepositChain(chain)}
                className={cn(
                  'rounded-full border px-3 py-1 font-display text-xs font-bold transition-colors',
                  empty
                    ? 'border-[#00FF87]/40 bg-[#00FF87]/10 text-[#00FF87] hover:bg-[#00FF87]/20'
                    : 'border-white/15 text-ink-600 hover:border-[#00FF87]/40 hover:text-[#00FF87]',
                )}
              >
                Deposit
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 font-body text-xs leading-relaxed text-ink-400">Each chain has its own USDC — coins on that chain trade with it.</p>

      <FundModal open={depositChain !== null} onClose={() => setDepositChain(null)} initialChain={depositChain ?? undefined} />
    </div>
  );
}
