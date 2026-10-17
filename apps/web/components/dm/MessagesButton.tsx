'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { useDmUnread } from '@/lib/dm-client';
import { hasStoredSession } from '@/lib/session-client';

/** The way into private messages (2026-10-17): a chat bubble beside the bell, with the count
 *  of unread messages (requests count too — someone is waiting). */
export function MessagesButton({ className }: { className?: string }) {
  const t = useTranslations('dm');
  const unread = useDmUnread();
  const count = (unread?.messages ?? 0) + (unread?.requests ?? 0);
  // Signed-in only — checked after mount so the server render and the first client render match.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(hasStoredSession()), []);
  if (!signedIn) return null;
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
