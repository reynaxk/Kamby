'use client';

import { motion } from 'framer-motion';

export interface LandingFeature {
  icon?: string;
  title: string;
  body: string;
}

/** The landing page's features: quiet text panels that rise in on scroll; a thin green border on hover. */
export function FeatureCards({ features }: { features: readonly LandingFeature[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {features.map((f, i) => (
        <motion.div
          key={f.title}
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.45, delay: (i % 3) * 0.07, ease: 'easeOut' }}
          className="rounded-2xl border border-white/5 bg-white/[0.015] px-6 py-7 backdrop-blur-md transition-colors duration-300 hover:border-[#00FF87]/30"
        >
          {f.icon && <div className="text-2xl">{f.icon}</div>}
          <h3 className="mt-4 font-display text-[1rem] font-bold tracking-tight text-white">{f.title}</h3>
          <p className="mt-2 font-body text-[0.84rem] leading-[1.7] text-[#64748B]">{f.body}</p>
        </motion.div>
      ))}
    </div>
  );
}
