'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { useDmUnread } from '@/lib/dm-client';
import { hasStoredSession } from '@/lib/session-client';

/** The way into private messages (2026-10-17): a chat bubble beside the bell, with the count
 *  of unread messages (requests count too — someone is waiting). */
export function MessagesButton({ className, screen }: { className?: string; screen?: 'phone' | 'desktop' }) {
  // Signed-in only, and only on the screen size it's placed for (the phone home row and the
  // desktop header both carry one) — checked after mount so server and client renders match.
  const [show, setShow] = useState(false);
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)').matches;
    setShow(hasStoredSession() && (!screen || (screen === 'desktop') === wide));
  }, [screen]);
  if (!show) return null;
  return <MessagesLink className={className} />;
}

function MessagesLink({ className }: { className?: string }) {
  const t = useTranslations('dm');
  const unread = useDmUnread();
  const count = (unread?.messages ?? 0) + (unread?.requests ?? 0);
  return (
    <Link
      href="/messages"
      aria-label={count > 0 ? t('openWithUnread', { count }) : t('open')}
      className={cn('relative flex h-10 w-10 items-center justify-center rounded-full text-ink-600 transition-colors hover:text-ink-900 active:bg-white/10', className)}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />
      </svg>
      {count > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-body text-[0.6rem] font-bold text-black">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}
