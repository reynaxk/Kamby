'use client';

import { motion, useMotionTemplate, useMotionValue, useSpring } from 'framer-motion';
import type { PointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';

export type LandingIcon = 'gas' | 'shield' | 'dollar' | 'launch' | 'chat' | 'card';

export interface LandingFeature {
  icon: LandingIcon;
  title: string;
  body: string;
}

/** Kamby's own line icons (2026-10-15, replacing emoji): neon strokes in a dark tile. */
function Icon({ name, size = 22 }: { name: LandingIcon; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
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

const GAS_CHAINS: [BadgeChain, string][] = [['solana', 'Solana'], ['base', 'Base'], ['bnb', 'BNB'], ['robinhood', 'Robinhood']];

/** Bento placement (lg): the first feature is the big 2×2 tile, the rest fill around it. */
const SPAN = ['lg:col-span-2 lg:row-span-2', '', '', '', '', ''];

/**
 * One bento tile: a frosted panel whose neon edge brightens on hover, with a soft light that
 * follows the cursor and a gentle 3D tilt (mouse only — touch screens get none). Transform and
 * a background gradient only, so it stays smooth.
 */
function Tile({ f, index }: { f: LandingFeature; index: number }) {
  const big = index === 0;
  const rx = useSpring(useMotionValue(0), { stiffness: 220, damping: 22 });
  const ry = useSpring(useMotionValue(0), { stiffness: 220, damping: 22 });
  const mx = useMotionValue(50);
  const my = useMotionValue(50);
  const light = useMotionTemplate`radial-gradient(420px circle at ${mx}% ${my}%, rgba(0,255,135,0.13), transparent 60%)`;

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    mx.set(px * 100);
    my.set(py * 100);
    rx.set((0.5 - py) * (big ? 5 : 8));
    ry.set((px - 0.5) * (big ? 5 : 8));
  }
  function onLeave() {
    rx.set(0);
    ry.set(0);
  }

  return (
    <motion.div
      initial={{ y: 18 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay: (index % 3) * 0.06, ease: 'easeOut' }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`kamby-bento group relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-[linear-gradient(160deg,rgba(255,255,255,0.06),rgba(255,255,255,0.012)_60%)] p-6 transition-[border-color,box-shadow] duration-300 hover:border-emerald-500/60 ${SPAN[index] ?? ''} ${big ? 'flex flex-col justify-between lg:p-9' : ''}`}
    >
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: light }} />
      {big && (
        <svg className="pointer-events-none absolute -bottom-16 -right-16 h-[300px] w-[300px]" viewBox="0 0 512 512" aria-hidden>
          <g fill="none" stroke="#00FF87" strokeWidth="92" strokeLinecap="round" opacity="0.07">
            <path d="M186 140 V372" />
            <path d="M200 268 L338 140" />
            <path d="M232 246 L346 372" />
          </g>
        </svg>
      )}
      <span
        className={`relative flex items-center justify-center rounded-2xl border border-[#00FF87]/20 bg-[#00FF87]/[0.08] text-[#00FF87] transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:rotate-[-6deg] group-hover:scale-110 ${big ? 'h-14 w-14' : 'h-11 w-11'}`}
      >
        <Icon name={f.icon} size={big ? 28 : 22} />
      </span>
      {big && <GasReceipt />}
      <div className="relative">
        <h3 className={`font-display font-bold tracking-tight text-white ${big ? 'mt-10 text-3xl sm:text-4xl' : 'mt-5 text-[1.05rem]'}`}>{f.title}</h3>
        <p className={`mt-2 font-body leading-[1.65] text-[#7C8798] ${big ? 'max-w-md text-base' : 'text-[0.86rem]'}`}>{f.body}</p>
        {big && (
          // The four chains, each with the gas a Kamby user pays on it: none.
          <div className="mt-6 flex flex-wrap gap-2" aria-hidden>
            {GAS_CHAINS.map(([chain, name]) => (
              <span key={chain} className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/30 py-1.5 pl-1.5 pr-3">
                <span className="relative h-5 w-5">
                  <ChainBadge chain={chain} className="!static !h-5 !w-5 !ring-0" />
                </span>
                <span className="font-display text-xs font-bold text-white">{name}</span>
                <span className="font-mono text-[0.65rem] font-semibold text-[#00FF87]">gas $0</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** The big tile's picture (2026-10-29 — it was an empty box): a trade's receipt where the network
 *  gas is struck through and Kamby pays it. */
function GasReceipt() {
  const t = useTranslations('landing');
  return (
    <div aria-hidden className="relative mt-8 w-full max-w-sm rounded-2xl border border-white/[0.08] bg-black/40 p-4 font-body text-sm">
      <div className="flex justify-between py-1.5 text-white/60">
        <span>{t('rcSwap')}</span>
        <span className="font-display font-bold tabular-nums text-white">$50.00 USDC</span>
      </div>
      <div className="flex justify-between border-t border-dashed border-white/10 py-1.5 text-white/60">
        <span>{t('rcGas')}</span>
        <span className="tabular-nums">
          <span className="mr-2 text-white/30 line-through">$0.42</span>
          <span className="font-display font-black text-[#00FF87]">$0.00</span>
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 rounded-xl bg-[#00FF87]/10 px-3 py-2 font-display text-xs font-bold text-[#00FF87]">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#00FF87] text-[0.6rem] text-black">✓</span>
        {t('rcPaid')}
      </div>
    </div>
  );
}

/** The landing page's features as a bento grid (2026-10-17): one hero tile and five around it. */
export function FeatureCards({ features }: { features: readonly LandingFeature[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:auto-rows-[minmax(13rem,auto)]">
      {features.map((f, i) => (
        <Tile key={f.title} f={f} index={i} />
      ))}
    </div>
  );
}
