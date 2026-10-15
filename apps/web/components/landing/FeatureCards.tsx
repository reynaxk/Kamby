'use client';

import { motion } from 'framer-motion';

export type LandingIcon = 'gas' | 'shield' | 'dollar' | 'launch' | 'chat' | 'card';

export interface LandingFeature {
  icon: LandingIcon;
  title: string;
  body: string;
}

/** Kamby's own line icons (2026-10-15, replacing emoji): neon strokes in a dark tile, no glow. */
function Icon({ name }: { name: LandingIcon }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'gas':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
          <path d="m8.5 12 2.5 2.5L16 9.5" />
        </svg>
      );
    case 'dollar':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M15 9.2c-.5-1-1.6-1.6-3-1.6-1.8 0-3 .9-3 2.2 0 3.1 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.5 0-2.7-.7-3.1-1.8M12 6v1.6M12 16.6V18" />
        </svg>
      );
    case 'launch':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3v12M7 8l5-5 5 5" />
          <path d="M5 15v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" />
          <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
        </svg>
      );
    case 'card':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="3" />
          <path d="m8 15 3-3 2 2 3-4" />
          <path d="M8 7h4" />
        </svg>
      );
  }
}

/**
 * The landing page's features: crisp dark panels, each with a neon line icon in its own tile. They
 * rise into place on scroll — transform only, never hidden first (a slow phone must never show an
 * empty page).
 */
export function FeatureCards({ features }: { features: readonly LandingFeature[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((f, i) => (
        <motion.div
          key={f.title}
          initial={{ y: 16 }}
          whileInView={{ y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.45, delay: (i % 3) * 0.06, ease: 'easeOut' }}
          className="group rounded-3xl border border-white/[0.06] bg-gradient-to-b from-white/[0.035] to-white/[0.01] p-6 transition-colors duration-300 hover:border-[#00FF87]/30"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#00FF87]/20 bg-[#00FF87]/[0.08] text-[#00FF87]">
            <Icon name={f.icon} />
          </span>
          <h3 className="mt-5 font-display text-[1.05rem] font-bold tracking-tight text-white">{f.title}</h3>
          <p className="mt-1.5 font-body text-[0.86rem] leading-[1.65] text-[#7C8798]">{f.body}</p>
        </motion.div>
      ))}
    </div>
  );
}
