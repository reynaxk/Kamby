'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

/** Desktop "back to Discover" (2026-10-18 audit: a lone grey mono "← Back to Discover" line) —
 *  a small glass pill with a chevron, the same shape as the rest of the header's controls. */
export function BackPill({ href, className = '' }: { href: string; className?: string }) {
  const tU = useTranslations('ui');
  return (
    <Link
      href={href}
      className={`inline-flex h-8 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] pl-2 pr-3 font-body text-xs font-semibold text-ink-400 transition-colors hover:border-white/20 hover:text-ink-900 ${className}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m15 18-6-6 6-6" />
      </svg>
      {tU('discover_abfc')}
    </Link>
  );
}
