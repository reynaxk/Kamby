'use client';

import { useState } from 'react';
import { cn } from '@kamby/ui';
import { FundModal } from './FundModal';
import { useTranslations } from 'next-intl';

/**
 * Entry point for the Fund modal — same "one entry point, both placements" shape as
 * SendButton.tsx (icon variant next to BlurBalancesToggle/ConnectWalletButton in the header,
 * labeled variant on the profile page next to Send/Withdraw). Kept as a separate component
 * from FundModal for the same reason SendButton is separate from SendModal: FundModal reuses
 * ConnectWalletButton for its EVM wrong-network gate, so nesting the trigger inside FundModal
 * itself would be a circular import.
 */
export function FundButton({ variant = 'icon' }: { variant?: 'icon' | 'labeled' }) {
  const tU = useTranslations('ui');
  const tW = useTranslations('wallet');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tW('deposit')}
        title={tU('deposit_92f8')}
        className={cn(
          variant === 'icon'
            ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-raised hover:text-ink-900'
            // shrink-0 here too, not just on the icon variant above — without it, the button
            // could shrink below "Fund wallet"'s natural width in a tight flex row (e.g. next
            // to Send on /account), wrapping the two-word label onto two lines.
            // The money buttons (2026-10-13, owner: "not basic"): Deposit is the solid neon one,
            // its icon in a small dark disc. Flat — no glow.
            : 'flex shrink-0 items-center justify-center gap-2.5 whitespace-nowrap rounded-2xl bg-accent px-4 py-3 font-display text-sm font-bold text-black transition-transform active:scale-[0.97]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        {variant === 'labeled' ? (
          <>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/15">
              <FundIcon />
            </span>
            {tW('deposit')}
          </>
        ) : (
          <FundIcon />
        )}
      </button>
      <FundModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function FundIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}
