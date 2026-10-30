'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { DmInbox } from './DmInbox';

/** True from 768px up (Tailwind `md`) — null until the browser says, so nothing renders twice. */
function useWide(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    setWide(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/**
 * Messages on a computer (2026-10-17): Instagram / Discord-style two panes — your chats stay on
 * the left, the open chat on the right. Phones keep one screen at a time. `--dm-left` tells the
 * chat's fixed composer where the right pane starts.
 */
export function MessagesShell({ children, home = null }: { children: React.ReactNode; home?: React.ReactNode }) {
  const t = useTranslations('dm');
  const wide = useWide();
  if (wide === null) return <div className="kamby-void min-h-screen bg-bg" />;
  if (!wide) return <div className="kamby-void min-h-screen bg-bg">{home ?? children}</div>;
  return (
    <div className="kamby-void min-h-screen bg-bg [--dm-left:calc(var(--nav-w,0px)+340px)] xl:[--dm-left:calc(var(--nav-w,0px)+380px)]">
      <aside className="fixed bottom-[var(--ticker-h)] left-[var(--nav-w,0px)] top-0 z-30 flex w-[340px] flex-col border-r border-white/[0.06] bg-[#020203]/70 xl:w-[380px]">
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          {/* From lg up the logo is in the left menu (DesktopSideNav) — the pane just says Messages. */}
          <Link href="/home" className="flex items-center gap-2 lg:hidden" aria-label="Kamby">
            <KambyLogo size="sm" />
          </Link>
          <span className="font-display text-sm font-bold text-ink-400 lg:text-xl lg:font-extrabold lg:text-ink-900">{t('title')}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2 [scrollbar-width:thin]">
          <DmInbox />
        </div>
      </aside>
      <div className="pl-[340px] xl:pl-[380px]">{home ? <EmptyPane /> : children}</div>
    </div>
  );
}

/** The right pane before you pick a chat. */
function EmptyPane() {
  const t = useTranslations('dm');
  return (
    <div className="flex min-h-screen items-center justify-center px-8">
      <div className="text-center">
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-[30%] border border-accent/25 bg-accent/[0.08] text-accent" aria-hidden>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />
          </svg>
        </span>
        <p className="mt-5 font-display text-2xl font-black tracking-tight text-ink-900">{t('pickTitle')}</p>
        <p className="mx-auto mt-2 max-w-sm font-body text-sm text-ink-400">{t('pickBody')}</p>
      </div>
    </div>
  );
}
