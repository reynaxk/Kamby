'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
 *
 * `desktop` (2026-10-14, the PnL share card): also show it on big screens, as a centred card.
 */
export function MobileDrawer({
  open,
  onClose,
  title,
  children,
  desktop = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  desktop?: boolean;
}) {
  const tU = useTranslations('ui');
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

  const sheet = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
            className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm ${desktop ? '' : 'lg:hidden'}`}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className={`kamby-glass-solid kamby-sheet-solid fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl border-b-0 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] ${desktop ? 'lg:inset-0 lg:m-auto lg:h-fit lg:w-[440px] lg:rounded-3xl lg:border-b' : 'lg:hidden'}`}
          >
            {/* A grab handle, like a native sheet (phones). */}
            <div aria-hidden className={`mx-auto -mt-1 mb-3 h-1 w-10 rounded-full bg-white/15 ${desktop ? 'lg:hidden' : ''}`} />
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="min-w-0 truncate font-display text-lg font-bold text-ink-900">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={tU('close_d3d2')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-ink-400 transition-colors hover:text-ink-900 active:scale-95"
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
  // A desktop card is portalled to <body> (which carries kamby-void), so a moving/transformed
  // panel it was opened from can't trap its fixed position.
  return desktop && typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
}
