'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * A generic bottom-sheet drawer for mobile — the terminal's answer to "make the trading
 * panel a drawer" (and the token list too) on screens too narrow for the 3-column desktop
 * layout. `lg:hidden` on both layers is defense-in-depth: the caller is expected to only
 * ever mount this under useIsMobile(), but a CSS-level guard costs nothing and means this
 * can never visibly appear on desktop even if that assumption is ever violated.
 *
 * Locks body scroll and closes on Escape while open — the two things a bottom sheet needs
 * to not feel broken. Exit animation needs real AnimatePresence (unlike TradePanel's own
 * entrance-only springs — see that file's doc comment on why it avoids this): a drawer that
 * just vanishes instead of sliding away reads as a glitch, not a deliberate close.
 */
export function MobileDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
            className="fixed inset-0 z-50 bg-black/60 lg:hidden"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 lg:hidden"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink-900">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-full p-1 text-ink-400 transition-colors hover:bg-surface-raised hover:text-ink-900"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
