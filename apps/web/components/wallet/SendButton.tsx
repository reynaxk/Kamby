'use client';

import { useState } from 'react';
import { cn } from '@kamby/ui';
import { SendModal } from './SendModal';
import { useTranslations } from 'next-intl';

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
  const tU = useTranslations('ui');
  const tW = useTranslations('wallet');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tW('withdraw')}
        title={tU('withdraw_9d5d')}
        className={cn(
          variant === 'icon'
            ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-raised hover:text-ink-900'
            : 'flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-accent shadow-[0_0_18px_rgba(0,255,135,0.15)] transition-all hover:border-accent hover:bg-accent/20 hover:shadow-[0_0_26px_rgba(0,255,135,0.35)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        <WithdrawIcon />
        {variant === 'labeled' && tW('withdraw')}
      </button>
      <SendModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function WithdrawIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
