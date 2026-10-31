'use client';

import { useEffect, useState } from 'react';
import { markStep } from '@/lib/onboarding';
import { useTranslations } from 'next-intl';
import { ShareTradeSheet, type ShareChain } from '@/components/social/ShareTradeSheet';
import { Bolt } from '@/components/social/Bolt';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

/**
 * A confirmed trade, Kamby style (2026-10-10, owner: "make it in our type"): the neon check
 * pops in on a pulsing ring. A short buzz on phones that support it. (The "gas-free" line
 * under it was removed 2026-10-11 — owner: showing it off looked cheap.)
 */
export function TradeSuccess({ title, share }: { title: string; share?: { chain: ShareChain; tokenAddress: string } }) {
  const t = useTranslations('snipe');
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    markStep('traded');
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
          className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent text-black ring-8 ring-accent/15"
        >
          <Check className="h-8 w-8" strokeWidth={3} aria-hidden />
        </motion.span>
      </div>
      <p className="font-display text-lg font-bold text-ink-900">{title}</p>
      {share && (
        <>
          {/* Share your entry so friends can ⚡ Copy Snipe it — only if you want to. */}
          <button
            type="button"
            onClick={() => setSharing(true)}
            className="kamby-pop flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 font-display text-sm font-bold text-accent transition-transform active:scale-95"
          >
            <Bolt className="h-3.5 w-3.5" />
            {t('shareToChat')}
          </button>
          {sharing && <ShareTradeSheet open={sharing} onClose={() => setSharing(false)} chain={share.chain} tokenAddress={share.tokenAddress} />}
        </>
      )}
    </div>
  );
}

