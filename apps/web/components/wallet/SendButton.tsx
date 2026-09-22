'use client';

import { useState } from 'react';
import { SendModal } from './SendModal';

/** Header entry point for the Send modal — a separate component from ConnectWalletButton
 *  (not a dropdown item on it) specifically because SendModal itself reuses
 *  ConnectWalletButton for its EVM wrong-network gate; nesting the trigger inside the
 *  component SendModal already imports would be a circular import. Same "one entry point,
 *  reused everywhere" shape as TradeButton.tsx -> TradeModal -> TradePanel. */
export function SendButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send"
        title="Send"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-raised hover:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <SendIcon />
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
