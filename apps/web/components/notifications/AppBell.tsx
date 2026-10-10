'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { fetchUnreadCount } from '@/lib/notifications-client';
import { hasStoredSession } from '@/lib/session-client';

/** The phone app's bell (2026-10-10): opens the Notifications screen, a dot with the unread
 *  count when there's something new. Refreshes when you come back to the app. */
export function AppBell() {
  const tU = useTranslations('ui');
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (!hasStoredSession() || document.visibilityState !== 'visible') return;
      fetchUnreadCount()
        .then((n) => !cancelled && setUnread(n))
        .catch(() => {});
    };
    load();
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', load);
    };
  }, []);
  return (
    <Link href="/notifications" aria-label={tU('notifications_a274')} className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink-600 active:bg-white/10">
      <Bell className="h-5 w-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-down px-1 font-body text-[0.6rem] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}
