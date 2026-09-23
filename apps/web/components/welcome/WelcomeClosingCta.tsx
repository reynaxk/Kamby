'use client';

import { motion } from 'framer-motion';
import { Button } from '@kamby/ui';

export function WelcomeClosingCta({ onStartTrading }: { onStartTrading: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
      className="border-t border-line"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-6 py-16 text-center">
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink-900">
          Ready to trade?
        </h2>
        <Button
          type="button"
          variant="primary"
          onClick={onStartTrading}
          className="shadow-glow-accent px-8 py-3 text-base"
        >
          Start trading
        </Button>
      </div>

      <footer className="flex flex-col items-center gap-1 px-6 pb-10 text-center">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-lg">
            🔥
          </span>
          <span className="font-display text-base font-extrabold tracking-tight text-ink-900">
            Kamby
          </span>
        </div>
        <p className="font-body text-xs text-ink-400">
          © 2026 Kamby. Not custodial. Not financial advice.
        </p>
      </footer>
    </motion.div>
  );
}
