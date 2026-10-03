import { cn } from '@kamby/ui';

export type BadgeChain = 'base' | 'bnb' | 'solana';

/** Exported for tests. A market's chain identifier → which badge to draw (null = none). */
export function badgeChainFor(chainIdentifier: string): BadgeChain | null {
  const id = chainIdentifier.toLowerCase();
  if (id === 'solana') return 'solana';
  if (id === 'eip155:8453') return 'base';
  if (id === 'eip155:56') return 'bnb';
  return null;
}

const NAMES: Record<BadgeChain, string> = { base: 'Base', bnb: 'BNB Chain', solana: 'Solana' };

/**
 * The chain a coin trades on, as a tiny mark on the corner of its logo (user request
 * 2026-10-03: "so the users can see before they click it"). Simple drawn marks, not the
 * chains' official artwork. Place inside a `relative` wrapper around the coin logo.
 */
export function ChainBadge({ chain, className }: { chain: BadgeChain; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`on ${NAMES[chain]}`}
      title={NAMES[chain]}
      className={cn('absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center overflow-hidden rounded-full ring-2 ring-surface', className)}
    >
      {chain === 'base' && (
        <svg viewBox="0 0 12 12" className="h-full w-full" aria-hidden>
          <circle cx="6" cy="6" r="6" fill="#0052FF" />
          <rect x="3" y="5.1" width="6" height="1.8" rx="0.4" fill="#fff" />
        </svg>
      )}
      {chain === 'bnb' && (
        <svg viewBox="0 0 12 12" className="h-full w-full" aria-hidden>
          <circle cx="6" cy="6" r="6" fill="#F0B90B" />
          <path d="M6 2.6 7.3 3.9 6 5.2 4.7 3.9Z M3.9 4.7 5.2 6 3.9 7.3 2.6 6Z M8.1 4.7 9.4 6 8.1 7.3 6.8 6Z M6 6.8 7.3 8.1 6 9.4 4.7 8.1Z" fill="#1E2026" />
        </svg>
      )}
      {chain === 'solana' && (
        <svg viewBox="0 0 12 12" className="h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="kamby-sol-badge" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#9945FF" />
              <stop offset="1" stopColor="#14F195" />
            </linearGradient>
          </defs>
          <circle cx="6" cy="6" r="6" fill="#0B0B12" />
          <path d="M3.4 3.5h5.4l-0.9 1H2.5Z M2.5 5.5h5.4l0.9 1H3.4Z M3.4 7.5h5.4l-0.9 1H2.5Z" fill="url(#kamby-sol-badge)" />
        </svg>
      )}
    </span>
  );
}
