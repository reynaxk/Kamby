'use client';

import { useState } from 'react';
import { cn } from '@kamby/ui';
import { SendModal } from './SendModal';

/**
 * Entry point for the Send modal — a separate component from ConnectWalletButton (not a
 * dropdown item on it) specifically because SendModal itself reuses ConnectWalletButton
 * for its EVM wrong-network gate — nesting the trigger inside the component SendModal
 * already imports would be a circular import. Same "one entry point, reused everywhere"
 * shape as TradeButton.tsx -> TradeModal -> TradePanel; both the header icon and the
 * profile page's labeled button are this same component, just styled differently, not two
 * separate implementations to keep in sync.
 *
 * `variant="labeled"` — the profile-page placement (see app/account/page.tsx) — matches
 * where a "Send"/"Withdraw" action actually lives on comparable trading terminals: next to
 * your own balance, not buried in a header icon only. `variant="icon"` (default) is the
 * compact header form next to BlurBalancesToggle/ConnectWalletButton.
 */
export function SendButton({ variant = 'icon' }: { variant?: 'icon' | 'labeled' }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send"
        title="Send"
        className={cn(
          variant === 'icon'
            ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-raised hover:text-ink-900'
            : 'flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-4 py-2.5 font-body text-sm font-semibold text-ink-900 transition-colors hover:border-accent/60 hover:text-accent',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        <SendIcon />
        {variant === 'labeled' && 'Send'}
      </button>
      <SendModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
