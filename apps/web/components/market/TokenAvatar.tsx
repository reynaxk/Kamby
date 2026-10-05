'use client';

import { useEffect, useState } from 'react';
import { cn } from '@kamby/ui';

/** Fast IPFS gateways, best first (measured 2026-10-05: ipfs.io and dweb.link answered 429 to
 *  most requests, so a third of all coin icons never appeared; Pinata's public gateway took ~6s). */
const IPFS_GATEWAYS = ['https://pump.mypinata.cloud/ipfs/', 'https://ipfs.filebase.io/ipfs/'];
const IPFS_PATH = /^(?:ipfs:\/\/|https?:\/\/[^/]+\/ipfs\/)([a-zA-Z0-9]{46,}(?:\/[^?#]*)?)/;

/** Exported for tests. The URLs to try for a coin icon, in order — an IPFS image on every fast gateway. */
export function iconCandidates(url: string | null | undefined): string[] {
  if (!url) return [];
  const ipfs = url.match(IPFS_PATH);
  if (ipfs) return IPFS_GATEWAYS.map((gateway) => gateway + ipfs[1]);
  return url.startsWith('https://') ? [url] : [];
}

/** A stable hue from the coin's address, so each coin keeps its own colours. */
function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

/**
 * A coin's icon everywhere in the app (2026-10-05: "icons not appearing on the coins"). Tries
 * each candidate URL in turn and, when there's no image or none loads, a generated avatar — a
 * gradient unique to the coin with its first letter — instead of grey initials. Never a
 * fabricated logo: the generated mark is plainly not one.
 */
export function TokenAvatar({
  src,
  seed,
  label,
  className,
}: {
  src: string | null | undefined;
  /** The coin's address — picks the generated avatar's colours. */
  seed: string;
  /** The symbol (or name) — its first letter is the generated avatar's mark. */
  label: string | null | undefined;
  /** Size and shape, e.g. "h-9 w-9 text-sm". */
  className?: string;
}) {
  const candidates = iconCandidates(src);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [src]);
  const current = candidates[attempt];

  if (current) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={current}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setAttempt((n) => n + 1)}
        className={cn('shrink-0 rounded-full bg-surface-raised object-cover', className)}
      />
    );
  }
  const hue = hueFor(seed);
  const letter = (label?.replace(/^\$+/, '').trim() || '?').slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white', className)}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 85% 55%), hsl(${(hue + 55) % 360} 80% 38%))`,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
        textShadow: '0 1px 2px rgba(0,0,0,0.35)',
      }}
    >
      {letter}
    </span>
  );
}
