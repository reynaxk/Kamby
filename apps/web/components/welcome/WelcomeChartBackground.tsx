'use client';

import { motion } from 'framer-motion';

/** One tile of a hand-picked, generally-upward jagged path (viewBox 0 0 1000 300, y=300 is
 *  the bottom) — not real price data (unlike WelcomeLivePrices, deliberately not a factual
 *  claim about any specific token), the same "up and to the right" motif every trading app's
 *  marketing uses, purely atmospheric behind the hero text. Starts and ends at the same
 *  y-coordinate (260) so two tiles placed back to back tile seamlessly — the same
 *  render-it-twice-and-scroll-by-one-tile trick TickerBar.tsx already uses for its own price
 *  marquee (see its `animate-marquee` doc comment), just ported to an SVG transform instead
 *  of a flex row. The dip back down near the end reads as a real pullback after a pump, not
 *  a seam artifact.
 */
const TILE_PATH =
  'M0,260 L80,245 L150,252 L230,225 L310,232 L390,205 L470,215 L550,185 L630,195 L710,160 L790,170 L850,140 L920,185 L1000,260';
const TILE_AREA_PATH = `${TILE_PATH} L1000,300 L0,300 Z`;

function ChartTile() {
  return (
    <>
      <path d={TILE_AREA_PATH} fill="url(#welcome-chart-fill)" />
      <path d={TILE_PATH} fill="none" className="stroke-up" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/**
 * Replaces the earlier ambient glow-blob treatment behind the hero — the user's dad's idea:
 * an animated chart that keeps going up, the same instinct every trading app's own landing
 * page leans on. An earlier version drew the line in via `pathLength` on a loop, but that
 * snaps back to fully invisible for about a second out of every six-second cycle — a real,
 * confirmed-via-screenshot dead spot, not just a theoretical risk. This version is always
 * fully visible and just scrolls continuously leftward instead, same mechanism as the
 * app-wide TickerBar's own marquee. `aria-hidden`, no interactive content, sits behind the
 * hero's real content (DOM order + `absolute`), so it never affects layout, a11y, or the
 * real CTA underneath it.
 */
export function WelcomeChartBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden opacity-40">
      <motion.svg
        viewBox="0 0 2000 300"
        preserveAspectRatio="none"
        className="h-full w-[200%]"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
      >
        <defs>
          <linearGradient id="welcome-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--kamby-up))" stopOpacity="0.28" />
            <stop offset="100%" stopColor="rgb(var(--kamby-up))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <ChartTile />
        <g transform="translate(1000,0)">
          <ChartTile />
        </g>
      </motion.svg>
    </div>
  );
}
