'use client';

import { useAccount } from 'wagmi';
import { useTranslations } from 'next-intl';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { cn } from '@kamby/ui';
import { useNativeTrading } from '@/lib/native-trading';
import { useWalletTotalUsd } from '@/components/wallet/NativeBalancesList';
import { FundButton } from '@/components/wallet/FundButton';
import { SendButton } from '@/components/wallet/SendButton';
import { formatSignedCompactUsd } from '@/lib/format';
import { useMyPositions } from '@/lib/my-positions';
import { useUsdcBalances } from '@/lib/use-usdc-balance';
import { useBalanceVisibility } from './BalanceVisibilityContext';
import { PnlSummary } from './PnlSummary';

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The top of the computer Portfolio (Kamby Prime, 2026-11-04, Robinhood-style): one big total —
 * cash plus what your coins are worth — the open P&L under it, and the money buttons beside it.
 * Same numbers as the phone Profile screen (AppProfileMenu).
 */
export function PortfolioTop() {
  const tH = useTranslations('home');
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const balances = useUsdcBalances(address, wallets[0]?.address);
  const positions = useMyPositions();
  const { hidden } = useBalanceVisibility();
  const native = useNativeTrading();
  const walletTotal = useWalletTotalUsd();
  const cash = native ? walletTotal : balances.total;
  const held = positions?.reduce((sum, p) => sum + (p.currentValueUsd ?? 0), 0) ?? 0;
  const openPnl = positions?.reduce((sum, p) => sum + (p.unrealizedPnlUsd ?? 0), 0) ?? 0;
  const total = cash === null ? null : cash + held;
  const [whole, cents] = total === null ? ['—', ''] : usd(total).split('.');

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm text-ink-600">{tH('totalBalance')}</p>
          <p className={cn('mt-2 font-mono text-[2.75rem] font-medium leading-none tracking-[-0.04em] text-ink-900 tabular-nums', hidden && 'select-none blur-md')}>
            {whole}
            {cents && <span className="text-ink-400">.{cents}</span>}
          </p>
          <p className={cn('mt-3 font-mono text-sm tabular-nums', !positions?.length ? 'text-ink-400' : openPnl >= 0 ? 'text-up' : 'text-down')}>
            {positions && positions.length > 0 ? `${formatSignedCompactUsd(openPnl)} ${tH('openPnl')}` : total === 0 ? tH('fundHint') : tH('noPositions')}
          </p>
        </div>
        <div className="flex gap-2">
          <FundButton variant="labeled" />
          <SendButton variant="labeled" />
        </div>
      </div>
      {address && (
        <div className="mt-6">
          <PnlSummary address={address} openPnl={openPnl} />
        </div>
      )}
    </section>
  );
}
