'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Bottom sheet on mobile, centered modal on larger screens — see
 * docs/TRADING.md#trading-ui's mobile requirement. One shell reused by every entry point
 * (token page, activity "Trade" action) so the trading experience is identical regardless
 * of where it was opened from.
 */
export function TradeModal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="kamby-void fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="kamby-fade-in absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="kamby-glass-solid kamby-sheet-up relative max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border-b-0 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-md sm:rounded-3xl sm:border-b sm:pb-5"
      >
        {/* A grab handle, like a native sheet (phones). */}
        <div aria-hidden className="mx-auto -mt-2 mb-4 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
