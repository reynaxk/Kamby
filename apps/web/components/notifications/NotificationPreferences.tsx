'use client';

import type { NotificationPreferences } from '@kamby/domain';
import { Surface } from '@kamby/ui';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/notifications-client';
import { useStoredSession } from '@/hooks/useStoredSession';
import { useTranslations } from 'next-intl';
import { PushToggle } from './PushToggle';

const FIELDS: { key: keyof NotificationPreferences; label: string; detail: string }[] = [
  { key: 'messages', label: 'Messages', detail: 'When someone sends you a private message' },
  { key: 'follows', label: 'New followers', detail: 'When someone starts following you' },
  { key: 'likes', label: 'Likes', detail: 'When someone likes one of your trades' },
  {
    key: 'followedTraderTrades',
    label: 'Trades from people you follow',
    detail: 'When a trader you follow makes a trade',
  },
  {
    key: 'whaleTrades',
    label: 'Whale trades',
    detail: `Large trades in tokens you've traded before`,
  },
  // trendingTokens: no longer sent (owner 2026-10-11) — so no switch for it either.
  {
    key: 'watchedTokenActivity',
    label: 'Watched token activity',
    detail: 'Large trades in a token on your watchlist',
  },
  { key: 'tradeUpdates', label: 'Your trades', detail: 'When your buy or sell goes through — or fails' },
  { key: 'priceMoves', label: 'Big price moves', detail: 'When a coin you hold or watch moves 15%+ in an hour' },
];

/** Server-authoritative toggles — see docs/NOTIFICATIONS.md#preferences. Every change is
 *  saved immediately (no separate "Save" step) and reflects the server's actual response,
 *  never an assumed value, so this can never drift from what the API will really enforce. */
export function NotificationPreferencesPanel() {
  const tU = useTranslations('ui');
  const tL = useTranslations('labels');
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState<keyof NotificationPreferences | null>(null);
  const [error, setError] = useState(false);

  // Read in an effect, never during render: the server can't see the session, so checking it
  // while rendering made the signed-in page differ from its HTML (React #418, 2026-10-18).
  const hasSession = useStoredSession();
  useEffect(() => {
    if (!hasSession) return;
    fetchNotificationPreferences()
      .then(setPrefs)
      .catch(() => setError(true));
  }, [hasSession]);

  async function toggle(key: keyof NotificationPreferences): Promise<void> {
    if (!prefs) return;
    const next = !prefs[key];
    setPrefs({ ...prefs, [key]: next }); // optimistic
    setSaving(key);
    try {
      const saved = await updateNotificationPreferences({ [key]: next });
      setPrefs(saved);
    } catch {
      setPrefs((current) => (current ? { ...current, [key]: !next } : current)); // revert
    } finally {
      setSaving(null);
    }
  }

  if (hasSession === false) {
    return (
      <EmptyState
        title={tU('verifyAWalletToManage_80aa')}
        detail={tL('prefsSignIn')}
      />
    );
  }
  if (error) {
    return <EmptyState title={tU('couldnTLoadYourPreferences_c37e')} detail={tL('tryAgainMoment')} />;
  }
  if (!prefs) {
    return (
      <Surface className="flex flex-col gap-3 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </Surface>
    );
  }

  return (
    <Surface className="flex flex-col divide-y divide-line p-2">
      <div className="pb-2">
        <PushToggle />
      </div>
      {FIELDS.map(({ key }) => {
        const label = tL(`pref_${key}`);
        const detail = tL(`pref_${key}_detail`);
        return (
        <div key={key} className="flex items-center justify-between gap-4 px-3 py-3">
          <div className="min-w-0">
            <p className="font-body text-sm font-medium text-ink-900">{label}</p>
            <p className="truncate font-body text-xs text-ink-400">{detail}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs[key]}
            aria-label={label}
            disabled={saving === key}
            onClick={() => void toggle(key)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${prefs[key] ? 'bg-accent' : 'bg-line'}`}
          >
            <span
              aria-hidden
              className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${prefs[key] ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`}
            />
          </button>
        </div>
        );
      })}
    </Surface>
  );
}
