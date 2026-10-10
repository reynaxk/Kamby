'use client';

import { useState } from 'react';
import { markAllNotificationsRead } from '@/lib/notifications-client';
import { hasStoredSession } from '@/lib/session-client';
import { NotificationList } from './NotificationList';
import { NotificationPreferencesPanel } from './NotificationPreferences';
import { useTranslations } from 'next-intl';

export function NotificationsPageClient() {
  const tU = useTranslations('ui');
  const [refreshKey, setRefreshKey] = useState(0);
  const [marking, setMarking] = useState(false);

  async function markAll(): Promise<void> {
    setMarking(true);
    try {
      await markAllNotificationsRead();
      setRefreshKey((key) => key + 1);
    } catch {
      // Nothing to reconcile — the list simply doesn't refresh; the button re-enables for a retry.
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-400">{tU('allNotifications_8e8a')}</h2>
          {hasStoredSession() && (
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={marking}
              className="font-mono text-xs text-accent hover:opacity-80 disabled:opacity-50"
            >
              {tU('markAllRead_2aa0')}
            </button>
          )}
        </div>
        <NotificationList limit={20} showLoadMore refreshKey={refreshKey} />
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-400">{tU('preferences_d083')}</h2>
        <NotificationPreferencesPanel />
      </section>
    </div>
  );
}
