'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** The Deposit / Withdraw sheets' top row (2026-10-13, owner: "they look basic"): the action's
 *  icon in a neon disc, its title, and a round close button. Flat — no glow. */
export function ModalHeader({ icon, title, onClose, closeLabel }: { icon: ReactNode; title: string; onClose: () => void; closeLabel: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">{icon}</span>
      <h2 className="min-w-0 flex-1 truncate font-display text-lg font-bold text-ink-900">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-ink-400 transition-colors hover:text-ink-900 active:scale-95"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** Down arrow into a tray — money coming in. */
export function DepositGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

/** Up arrow out of a tray — money going out. */
export function WithdrawGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}
