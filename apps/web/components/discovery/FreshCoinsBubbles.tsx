'use client';

import { useEffect, useRef, useState } from 'react';
import type { PumpFunTokenSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { fetchTrenches } from '@/lib/trenches-client';

const POLL_INTERVAL_MS = 12_000;
const MIN_RADIUS = 26;
const MAX_RADIUS = 58;
const DRIFT_SPEED = 0.35;
const MAX_SPEED = DRIFT_SPEED * 1.8;
const JITTER = 0.02;

function radiusFor(token: PumpFunTokenSummary): number {
  const t = Math.min(100, Math.max(0, token.graduationProgressPct)) / 100;
  return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
}

interface Bubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  token: PumpFunTokenSummary;
}

/**
 * A live pump.fun-style "new coins" bubble field — real FRESH-trench tokens (GET
 * /v1/tokens/trenches?category=FRESH, the same data TrenchesPanel's Fresh tab already
 * shows) drifting inside a bounded area, sized by graduationProgressPct: closer to
 * Pump.fun's ~85 SOL graduation threshold = bigger bubble, the same "hot" signal
 * TrenchesPanel's PumpFunRow already surfaces as a progress bar, just spatial here.
 *
 * Positions/velocities live in a ref, not React state — this is a continuous 60fps physics
 * sim, and re-rendering React on every frame would be real, measurable jank for zero
 * benefit; only the DOM nodes' transforms move per frame, via direct refs. New tokens spawn
 * at a random point instead of popping into a fixed slot; tokens that drop out of the FRESH
 * trench (graduated, or aged out) are simply removed on the next poll. Surviving bubbles
 * keep their position/velocity across polls — only size/data refreshes — so the field
 * never resets itself every 12s.
 *
 * Deliberately no click-to-trade — same reasoning as TrenchesPanel's Pump.fun rows: there's
 * no real per-token Solana trading route yet (Solana trading is fixed to SOL only, see
 * app/solana/page.tsx). A bubble opens the token on Solscan instead, the same external-link
 * pattern SocialFeed/TransactionDetail already use for Solana activity.
 */
export function FreshCoinsBubbles() {
  const [tokens, setTokens] = useState<PumpFunTokenSummary[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchTrenches('FRESH', 24)
        .then((result) => {
          if (cancelled) return;
          setTokens(result as PumpFunTokenSummary[]);
          setStatus('ready');
        })
        .catch(() => {
          if (!cancelled) setStatus('error');
        });
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (status === 'error') return null;
  if (status === 'ready' && tokens?.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-up" />
        </span>
        <span className="font-display text-xs font-bold uppercase tracking-wide text-ink-600">
          Fresh on Pump.fun
        </span>
      </div>
      <div className="relative h-[300px] w-full">
        {status === 'loading' && <p className="p-3 font-body text-xs text-ink-400">Loading…</p>}
        {tokens && tokens.length > 0 && <BubbleField tokens={tokens} />}
      </div>
    </div>
  );
}

function BubbleField({ tokens }: { tokens: PumpFunTokenSummary[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const bubblesRef = useRef<Map<string, Bubble>>(new Map());
  const [, bumpVersion] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    const width = el?.clientWidth ?? 600;
    const height = el?.clientHeight ?? 300;

    const seen = new Set<string>();
    for (const token of tokens) {
      seen.add(token.mintAddress);
      const existing = bubblesRef.current.get(token.mintAddress);
      const r = radiusFor(token);
      if (existing) {
        existing.token = token;
        existing.r = r;
      } else {
        const angle = Math.random() * Math.PI * 2;
        bubblesRef.current.set(token.mintAddress, {
          x: Math.random() * Math.max(1, width - r * 2) + r,
          y: Math.random() * Math.max(1, height - r * 2) + r,
          vx: Math.cos(angle) * DRIFT_SPEED,
          vy: Math.sin(angle) * DRIFT_SPEED,
          r,
          token,
        });
      }
    }
    for (const key of bubblesRef.current.keys()) {
      if (!seen.has(key)) {
        bubblesRef.current.delete(key);
        nodeRefs.current.delete(key);
      }
    }
    bumpVersion((v) => v + 1);
  }, [tokens]);

  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    let frame: number;
    const step = () => {
      const el = containerRef.current;
      const width = el?.clientWidth ?? 600;
      const height = el?.clientHeight ?? 300;
      const bubbles = Array.from(bubblesRef.current.values());

      for (const b of bubbles) {
        b.vx += (Math.random() - 0.5) * JITTER;
        b.vy += (Math.random() - 0.5) * JITTER;
        const speed = Math.hypot(b.vx, b.vy) || 1;
        const capped = Math.min(speed, MAX_SPEED);
        b.vx = (b.vx / speed) * capped;
        b.vy = (b.vy / speed) * capped;

        b.x += b.vx;
        b.y += b.vy;
        if (b.x - b.r < 0 || b.x + b.r > width) b.vx *= -1;
        if (b.y - b.r < 0 || b.y + b.r > height) b.vy *= -1;
        b.x = Math.min(Math.max(b.x, b.r), Math.max(b.r, width - b.r));
        b.y = Math.min(Math.max(b.y, b.r), Math.max(b.r, height - b.r));
      }

      // Soft pairwise separation so overlapping bubbles gently push apart instead of stacking.
      for (let i = 0; i < bubbles.length; i++) {
        const a = bubbles[i];
        if (!a) continue;
        for (let j = i + 1; j < bubbles.length; j++) {
          const c = bubbles[j];
          if (!c) continue;
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const minDist = a.r + c.r + 4;
          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            c.x += nx * overlap;
            c.y += ny * overlap;
          }
        }
      }

      for (const b of bubbles) {
        const node = nodeRefs.current.get(b.token.mintAddress);
        if (node) node.style.transform = `translate3d(${b.x - b.r}px, ${b.y - b.r}px, 0)`;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {tokens.map((token) => {
        const bubble = bubblesRef.current.get(token.mintAddress);
        if (!bubble) return null;
        return (
          <BubbleNode
            key={token.mintAddress}
            bubble={bubble}
            registerNode={(node) => {
              if (node) nodeRefs.current.set(token.mintAddress, node);
              else nodeRefs.current.delete(token.mintAddress);
            }}
          />
        );
      })}
    </div>
  );
}

function BubbleNode({
  bubble,
  registerNode,
}: {
  bubble: Bubble;
  registerNode: (node: HTMLAnchorElement | null) => void;
}) {
  const { token, r } = bubble;
  const close = token.graduationProgressPct >= 70;
  return (
    <a
      ref={registerNode}
      href={`https://solscan.io/token/${token.mintAddress}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`${token.symbol ? `$${token.symbol}` : token.mintAddress} — ${token.graduationProgressPct.toFixed(0)}% to graduation`}
      className={cn(
        'absolute left-0 top-0 flex select-none items-center justify-center overflow-hidden rounded-full border border-line bg-surface-raised text-center transition-shadow hover:border-accent/60',
        close && 'shadow-glow-accent',
      )}
      style={{ width: r * 2, height: r * 2, willChange: 'transform' }}
    >
      <span className="pointer-events-none px-1 font-display text-[0.65rem] font-bold leading-tight text-ink-900">
        {token.symbol ? `$${token.symbol}` : token.mintAddress.slice(0, 4)}
      </span>
    </a>
  );
}
