'use client';

import { motion } from 'framer-motion';
import { Surface } from '@kamby/ui';

const FEATURES = [
  {
    title: 'Leaderboard & PnL',
    body: 'Climb the ranks with real, tracked PnL history — not a vibes-based score.',
  },
  {
    title: 'One terminal, three chains',
    body: 'Solana, Base, and BNB Chain, one wallet — no bridging, no juggling apps.',
  },
  {
    title: 'Non-custodial by design',
    body: 'Kamby never holds your funds or signs on your behalf. Your keys, always.',
  },
  {
    title: 'Live Trenches',
    body: 'Catch new Solana launches the moment they appear, straight from the source.',
  },
  {
    title: 'Send, anywhere',
    body: 'A real non-custodial transfer to any wallet, on any of the three chains.',
  },
  {
    title: 'Built for speed',
    body: 'Quote, review, and confirm a trade in seconds, right from the terminal.',
  },
] as const;

export function WelcomeFeatureGrid() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, i) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8, delay: i * 0.06 }}
          >
            <Surface className="h-full p-5 transition-transform hover:-translate-y-1">
              <h3 className="font-display text-sm font-bold text-ink-900">{feature.title}</h3>
              <p className="mt-2 font-body text-sm text-ink-600">{feature.body}</p>
            </Surface>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
