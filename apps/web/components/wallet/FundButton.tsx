'use client';

import { useState } from 'react';
import { cn } from '@kamby/ui';
import { FundModal } from './FundModal';

/**
 * Entry point for the Fund modal — same "one entry point, both placements" shape as
 * SendButton.tsx (icon variant next to BlurBalancesToggle/ConnectWalletButton in the header,
 * labeled variant on the profile page next to Send/Withdraw). Kept as a separate component
 * from FundModal for the same reason SendButton is separate from SendModal: FundModal reuses
 * ConnectWalletButton for its EVM wrong-network gate, so nesting the trigger inside FundModal
 * itself would be a circular import.
 */
export function FundButton({ variant = 'icon' }: { variant?: 'icon' | 'labeled' }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Fund wallet"
        title="Fund wallet"
        className={cn(
          variant === 'icon'
            ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-raised hover:text-ink-900'
            : 'flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-4 py-2.5 font-body text-sm font-semibold text-ink-900 transition-colors hover:border-accent/60 hover:text-accent',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        <FundIcon />
        {variant === 'labeled' && 'Fund wallet'}
      </button>
      <FundModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function FundIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </svg>
  );
}
