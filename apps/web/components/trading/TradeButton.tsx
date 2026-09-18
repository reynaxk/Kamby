'use client';

import { useState } from 'react';
import { Button, type ButtonProps } from '@kamby/ui';
import type { TradeSide } from '@kamby/domain';
import { TradeModal } from './TradeModal';
import { TradePanel } from './TradePanel';

export interface TradeButtonProps {
  /** See TradePanel.tsx's own `chainId` doc comment — required for the same reason:
   *  added 2026-09-16 for BNB Chain going live, deliberately not defaulted to Base. */
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenDecimals: number;
  quoteTokenAddress: string;
  quoteTokenSymbol: string | null;
  quoteTokenDecimals: number;
  side?: TradeSide;
  label?: string;
  variant?: ButtonProps['variant'];
  className?: string;
}

/**
 * The one entry point every "Trade" / "Buy" / "Sell" CTA in the app uses — the token page
 * and an activity card's "Trade" action both render this same component with different
 * props, never a bespoke per-page trading implementation. See docs/TRADING.md#trading-ui.
 */
export function TradeButton({
  chainId,
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  quoteTokenAddress,
  quoteTokenSymbol,
  quoteTokenDecimals,
  side,
  label,
  variant = 'primary',
  className,
}: TradeButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)}>
        {label ?? (side === 'SELL' ? 'Sell' : side === 'BUY' ? 'Buy' : 'Trade')}
      </Button>
      <TradeModal open={open} onClose={() => setOpen(false)}>
        <TradePanel
          chainId={chainId}
          tokenAddress={tokenAddress}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          quoteTokenAddress={quoteTokenAddress}
          quoteTokenSymbol={quoteTokenSymbol}
          quoteTokenDecimals={quoteTokenDecimals}
          initialSide={side}
          onClose={() => setOpen(false)}
        />
      </TradeModal>
    </>
  );
}
