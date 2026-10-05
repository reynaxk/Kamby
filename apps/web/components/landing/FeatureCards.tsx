'use client';

import { motion } from 'framer-motion';

export interface LandingFeature {
  icon: string;
  title: string;
  body: string;
}

/** The landing page's feature grid: glass panels that rise in as they scroll into view. */
export function FeatureCards({ features }: { features: readonly LandingFeature[] }) {
  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((f, i) => (
        <motion.div
          key={f.title}
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.45, delay: (i % 3) * 0.08, ease: 'easeOut' }}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-[#00FF87]/45 hover:shadow-[0_0_28px_rgba(0,255,135,0.12)]"
        >
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-[radial-gradient(closest-side,rgba(0,255,135,0.2),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#00FF87]/30 bg-[#00FF87]/10 text-lg">{f.icon}</div>
          <h3 className="mt-4 font-display text-base font-bold text-white">{f.title}</h3>
          <p className="mt-1.5 font-body text-sm leading-relaxed text-[#94A3B8]">{f.body}</p>
        </motion.div>
      ))}
    </div>
  );
}
