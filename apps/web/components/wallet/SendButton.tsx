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
            // Withdraw is the glass one, its icon in a neon disc (see FundButton). No glow.
            : 'flex items-center justify-center gap-2.5 whitespace-nowrap rounded-2xl border border-white/10 bg-surface-raised px-4 py-3 font-display text-sm font-bold text-ink-900 transition-transform hover:border-accent/50 active:scale-[0.97]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        {variant === 'labeled' ? (
          <>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
              <WithdrawIcon />
            </span>
            {tW('withdraw')}
          </>
        ) : (
          <WithdrawIcon />
        )}
      </button>
      <SendModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function WithdrawIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}
