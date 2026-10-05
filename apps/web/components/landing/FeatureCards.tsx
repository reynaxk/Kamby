'use client';

import { motion } from 'framer-motion';

export interface LandingFeature {
  title: string;
  body: string;
}

/** The landing page's features: quiet text panels that rise in on scroll; a thin green border on hover. */
export function FeatureCards({ features }: { features: readonly LandingFeature[] }) {
  return (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((f, i) => (
        <motion.div
          key={f.title}
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.45, delay: (i % 3) * 0.07, ease: 'easeOut' }}
          className="rounded-xl border border-transparent px-4 py-5 transition-colors duration-300 hover:border-[#00FF87]/30"
        >
          <h3 className="font-display text-[0.95rem] font-bold tracking-tight text-white">{f.title}</h3>
          <p className="mt-2 font-body text-[0.84rem] leading-[1.7] text-[#64748B]">{f.body}</p>
        </motion.div>
      ))}
    </div>
  );
}
