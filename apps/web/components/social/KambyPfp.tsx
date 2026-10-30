import { cn } from '@kamby/ui';

/** The K's colours — Kamby's neon, then the brand's other accents. */
const INKS = ['#00FF87', '#00E5FF', '#FF5CA8', '#FFC94D', '#A78BFA', '#7DFFC0'];
const K_PATHS = ['M186 140 V372', 'M200 268 L338 140', 'M232 246 L346 372'];

/** Same person, same colour: a small hash of their name or address. */
export function pfpSeed(key: string): number {
  return Array.from(key).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
}

/**
 * The default profile picture (2026-10-30, owner: "Kamby theme pfp as default"): the Kamby K on
 * the app's near-black, in a colour picked from the person's name — for everyone without their
 * own picture. Decorative; the name next to it carries the identity.
 */
export function KambyPfp({ seedKey, className }: { seedKey: string; className?: string }) {
  const ink = INKS[pfpSeed(seedKey || '?') % INKS.length]!;
  return (
    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-[#05070A]', className)} style={{ borderColor: `${ink}40` }} aria-hidden>
      <svg viewBox="0 0 512 512" className="h-[62%] w-[62%]">
        <g fill="none" stroke={ink} strokeWidth="92" strokeLinecap="round" strokeLinejoin="round">
          {K_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
    </span>
  );
}
