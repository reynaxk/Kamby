'use client';

import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { useAccount } from 'wagmi';
import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { useNativeBalances, type NativeChain } from '@/lib/use-native-balances';
import { useUsdcBalances } from '@/lib/use-usdc-balance';

const NAME: Record<NativeChain, string> = { solana: 'Solana', base: 'Base', bnb: 'BSC', robinhood: 'Robinhood' };
const IDENT: Record<NativeChain, string> = { solana: 'solana', base: 'eip155:8453', bnb: 'eip155:56', robinhood: 'eip155:4663' };
const usd = (n: number | null) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const coin = (n: number | null) => (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: n !== null && n < 1 ? 5 : 3 });

/**
 * Each chain's balance in its own coin (2026-11-01, native-coin trading): SOL, ETH on Base, BNB on
 * BSC, ETH on Robinhood — and any USDC still held from before, which can be traded or converted.
 */
export function NativeBalancesList({ className }: { className?: string }) {
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const natives = useNativeBalances(address, wallets[0]?.address);
  const usdc = useUsdcBalances(address, wallets[0]?.address);
  const { hidden } = useBalanceVisibility();
  return (
    <ul className={cn('divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]', className)}>
      {natives.rows.map((r) => {
        const badge = badgeChainFor(IDENT[r.chain]);
        return (
          // An empty chain is dimmed, so the coins you hold stand out.
          <li key={r.chain} className={cn('flex items-center gap-3 px-4 py-3', !(r.amount && r.amount > 0) && 'opacity-[0.45]')}>
            {badge && <ChainBadge chain={badge} className="!static !h-7 !w-7 !ring-0" />}
            <span className="min-w-0 flex-1">
              <span className="block font-display text-sm font-bold text-ink-900">{r.symbol}</span>
              <span className="block font-body text-xs text-ink-400">{NAME[r.chain]}</span>
            </span>
            <span className={cn('text-right', hidden && 'select-none blur-sm')}>
              <span className="block font-mono text-sm font-semibold tabular-nums text-ink-900">
                {coin(r.amount)} {r.symbol}
              </span>
              <span className="block font-mono text-xs tabular-nums text-ink-400">{usd(r.usd)}</span>
            </span>
          </li>
        );
      })}
      {(usdc.total ?? 0) >= 0.01 && (
        <li className="flex items-center gap-3 px-4 py-3">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2775CA] font-display text-[0.65rem] font-black text-white">$</span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-sm font-bold text-ink-900">USDC</span>
            <span className="block font-body text-xs text-ink-400">Solana · Base · BSC · Robinhood</span>
          </span>
          <span className={cn('font-mono text-sm font-semibold tabular-nums text-ink-900', hidden && 'select-none blur-sm')}>{usd(usdc.total)}</span>
        </li>
      )}
    </ul>
  );
}

/** Natives plus any USDC, in dollars — the one total shown in the header and Profile. */
export function useWalletTotalUsd(): number | null {
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const natives = useNativeBalances(address, wallets[0]?.address);
  const usdc = useUsdcBalances(address, wallets[0]?.address);
  if (natives.totalUsd === null && usdc.total === null) return null;
  return (natives.totalUsd ?? 0) + (usdc.total ?? 0);
}
