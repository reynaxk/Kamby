'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DM_MUTE_OPTIONS, type DmConversation } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { muteConversation } from '@/lib/dm-client';
import { friendlyError } from '@/lib/friendly-error';
import { haptic } from './DmMessageView';

/** Mute a chat's notifications for a while (Instagram / Discord) — @mentions and replies still
 *  come through. Muted already: shows until when, and Unmute. */
export function MuteDrawer({ open, onClose, conv, onDone }: { open: boolean; onClose: () => void; conv: DmConversation; onDone: (c: DmConversation) => void }) {
  const t = useTranslations('dm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(minutes: number | null) {
    setBusy(true);
    setError(null);
    try {
      onDone(await muteConversation(conv.id, minutes));
      haptic();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const label = (m: number | null) => (m === null ? t('muteForever') : m < 24 * 60 ? t('muteHours', { count: m / 60 }) : t('muteWeek'));
  const until = conv.mute?.until ? new Date(conv.mute.until) : null;

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('muteNotifications')} desktop>
      {conv.mute ? (
        <>
          <p className="font-body text-sm text-ink-600">
            {until ? t('mutedUntil', { time: until.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }) : t('mutedForever')}
          </p>
          <button type="button" disabled={busy} onClick={() => void choose(0)} className="mt-4 w-full rounded-2xl bg-accent py-3.5 font-display text-base font-bold text-black transition-transform active:scale-[0.98] disabled:opacity-40">
            🔔 {t('unmute')}
          </button>
        </>
      ) : (
        <>
          <p className="font-body text-sm text-ink-400">{t('muteNote')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DM_MUTE_OPTIONS.map((m) => (
              <button
                key={String(m)}
                type="button"
                disabled={busy}
                onClick={() => void choose(m)}
                className={cn('rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-3.5 font-display text-sm font-bold text-ink-900 transition-transform active:scale-[0.97] disabled:opacity-40', m === null && 'col-span-2')}
              >
                {label(m)}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-2 font-body text-xs font-semibold text-down">{error}</p>}
    </MobileDrawer>
  );
}
