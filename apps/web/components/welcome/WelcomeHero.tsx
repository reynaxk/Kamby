'use client';

import { motion } from 'framer-motion';
import { Button } from '@kamby/ui';
import { WelcomeLivePrices } from './WelcomeLivePrices';

/** Same entrance spring TradePanel.tsx's Panel wrapper already uses (`STEP_SPRING`), reused
 *  here via a parent/child variants stagger instead of a single entrance key. */
const SPRING = { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 } as const;

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: SPRING },
};

export function WelcomeHero({ onStartTrading }: { onStartTrading: () => void }) {
  return (
    <div className="relative overflow-hidden">
      {/* Pure ambient decoration — two soft, slowly-drifting accent/up-tinted blurs behind
          the hero, so the page doesn't read as flat text-on-black next to fomo.family's own
          illustrated hero. Deliberately its own bespoke animation, not the shared
          `animate-glow-pulse` utility — that one's reserved for genuinely in-flight states
          elsewhere in the app (see WelcomeFeatureGrid's own note), and reusing it here for
          idle decoration would blur that meaning. `aria-hidden` + no interactive content, so
          it never affects layout or a11y. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-[70%] rounded-full bg-accent/20 blur-[120px]"
        animate={{ x: [0, 30, 0], y: [0, 20, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-10 left-1/2 h-[360px] w-[360px] translate-x-[10%] rounded-full bg-up/10 blur-[120px]"
        animate={{ x: [0, -20, 0], y: [0, 25, 0] }}
        transition={{ duration: 17, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative mx-auto flex max-w-3xl flex-col items-center gap-5 px-6 pb-16 pt-20 text-center sm:pt-28"
      >
        <motion.span
          variants={item}
          className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-display text-xs font-bold uppercase tracking-wide text-accent"
        >
          Live on Solana, Base &amp; BNB Chain
        </motion.span>

        <motion.h1 variants={item} className="font-display text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
          Your terminal. Your keys. Every chain.
        </motion.h1>

        <motion.p variants={item} className="max-w-xl font-body text-base text-ink-600 sm:text-lg">
          Trade Solana, Base, and BNB Chain from one non-custodial terminal — real-time prices,
          one-click buys, and a leaderboard to prove it.
        </motion.p>

        <motion.div variants={item}>
          <Button type="button" variant="primary" onClick={onStartTrading} className="shadow-glow-accent px-8 py-3 text-base">
            Start trading
          </Button>
        </motion.div>

        <motion.div variants={item}>
          <WelcomeLivePrices />
        </motion.div>
      </motion.div>
    </div>
  );
}
