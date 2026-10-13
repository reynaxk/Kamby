'use client';

import { useTranslations } from 'next-intl';
import type { BridgeChain } from '@/lib/bridge-client';
import type { useCrossChainFunding } from '@/lib/use-cross-chain-funding';

export const BRIDGE_CHAIN_NAME: Record<BridgeChain, string> = { base: 'Base', bnb: 'BNB Chain', solana: 'Solana' };

type Funding = ReturnType<typeof useCrossChainFunding>;

export function isMoveBusy(funding: Funding): boolean {
  return funding.stage === 'preparing' || funding.stage === 'signing' || funding.stage === 'moving';
}

/** The buy button's label while a buy needs (or is doing) a move from another chain. */
export function useMoveButtonLabel(funding: Funding, target: BridgeChain): string {
  const tL = useTranslations('labels');
  if (funding.stage === 'preparing') return tL('movePreparing');
  if (funding.stage === 'signing') return tL('moveSigning');
  if (funding.stage === 'moving') return tL('moveMoving', { chain: BRIDGE_CHAIN_NAME[target] });
  return tL('moveAndBuy', { amount: funding.moveUsd.toFixed(2), chain: funding.source ? BRIDGE_CHAIN_NAME[funding.source] : '' });
}

/** One line under the amount: where the USDC is and that Kamby moves it first — or why it couldn't. */
export function MoveNote({ funding, target }: { funding: Funding; target: BridgeChain }) {
  const tL = useTranslations('labels');
  if (funding.stage === 'error' && funding.error) {
    return <p className="text-center font-body text-xs font-semibold text-down">{funding.error}</p>;
  }
  if (!funding.source) return null;
  return (
    <p className="text-center font-body text-xs text-ink-400">
      {tL('moveNote', { from: BRIDGE_CHAIN_NAME[funding.source], to: BRIDGE_CHAIN_NAME[target], amount: funding.moveUsd.toFixed(2) })}
    </p>
  );
}
