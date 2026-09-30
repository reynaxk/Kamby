'use client';

import { cn } from '@kamby/ui';
import { useBalanceVisibility } from './BalanceVisibilityContext';

/** `labeled` is the /account wallet-section style, matching FundButton/SendButton there. */
export function BlurBalancesToggle({ variant = 'icon' }: { variant?: 'icon' | 'labeled' }) {
  const { hidden, toggle } = useBalanceVisibility();
  const label = hidden ? 'Show balances' : 'Hide balances';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={label}
      title={label}
      className={cn(
        variant === 'icon'
          ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-raised hover:text-ink-900'
          : 'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-line bg-surface-raised px-4 py-2.5 font-body text-sm font-semibold text-ink-900 transition-colors hover:border-accent/60 hover:text-accent',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
      )}
    >
      {hidden ? <EyeOffIcon /> : <EyeIcon />}
      {variant === 'labeled' && label}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M6.61 6.61A18.5 18.5 0 0 0 1 12s4 8 11 8a9.26 9.26 0 0 0 5.39-1.61" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
