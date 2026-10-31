'use client';

import { useEffect, useState } from 'react';
import { cn } from '@kamby/ui';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { LandingCta } from './LandingCta';

/**
 * The landing page's top bar (2026-10-31): stays at the top while you scroll — clear over the hero,
 * solid black once you're past it (no blur: it cost frames on phones) — with jump links to the
 * sections and Sign in.
 */
export function LandingHeader({ links, signIn }: { links: { href: string; label: string }[]; signIn: string }) {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={cn('sticky top-0 z-50 transition-colors duration-200', solid ? 'border-b border-white/[0.06] bg-[#050608]' : 'border-b border-transparent')}>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+0.9rem)]">
        <a href="#top" className="flex items-center gap-2" aria-label="Kamby">
          <KambyLogo />
        </a>
        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="hidden rounded-lg px-3 py-2 font-display text-sm font-semibold text-[#94A3B8] transition-colors hover:text-white md:block">
              {l.label}
            </a>
          ))}
          <LandingCta label={signIn} variant="ghost" className="ml-1 px-4 py-2" />
        </nav>
      </div>
    </header>
  );
}
