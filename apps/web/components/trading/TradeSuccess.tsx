'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * A confirmed trade, Kamby style (2026-10-10, owner: "make it in our type"): the neon check
 * pops in on a pulsing ring, with Kamby's promise under it — no gas, just USDC. A short buzz
 * on phones that support it.
 */
export function TradeSuccess({ title }: { title: string }) {
  const t = useTranslations('labels');
  useEffect(() => {
    try {
      navigator.vibrate?.(30);
    } catch {
      // Not supported — fine.
    }
  }, []);
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/25 [animation-iteration-count:2]" />
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent text-black shadow-[0_0_32px_rgba(0,255,135,0.6)]"
        >
          <Check className="h-8 w-8" strokeWidth={3} aria-hidden />
        </motion.span>
      </div>
      <p className="font-display text-lg font-bold text-ink-900">{title}</p>
      <p className="rounded-full bg-accent/10 px-3 py-1 font-body text-xs font-semibold text-accent">⚡ {t('gasFreeUsdc')}</p>
    </div>
  );
}

/** Kamby's promise, right above the trade button in the phone sheet. */
export function GasFreeNote() {
  const t = useTranslations('labels');
  return <p className="text-center font-body text-xs font-semibold text-accent">⚡ {t('gasFreeUsdc')}</p>;
}
