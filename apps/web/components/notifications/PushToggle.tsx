'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BellRing } from 'lucide-react';
import { cn } from '@kamby/ui';
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push-client';

/**
 * "Notifications on this phone" (2026-10-11): one switch that asks the phone for permission
 * and subscribes it to Kamby's push. On an iPhone outside the installed app it explains how
 * to install first (Apple only allows web push there).
 */
export function PushToggle() {
  const t = useTranslations('labels');
  const locale = useLocale();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  if (state === null) return null;

  const on = state === 'on';
  const canToggle = state === 'on' || state === 'off';
  const hint =
    state === 'needs-install' ? t('push_needsInstall') : state === 'denied' ? t('push_denied') : state === 'unsupported' ? t('push_unsupported') : t('push_sub');

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      setState(on ? await disablePush() : await enablePush(locale));
    } catch {
      setError(t('push_error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn('flex items-center justify-between gap-4 rounded-xl px-3 py-3', on ? 'bg-accent/10' : 'bg-surface-raised')}>
      <div className="flex min-w-0 items-start gap-3">
        <BellRing className={cn('mt-0.5 h-5 w-5 shrink-0', on ? 'text-accent' : 'text-ink-400')} aria-hidden />
        <div className="min-w-0">
          <p className="font-body text-sm font-semibold text-ink-900">{t('push_title')}</p>
          <p className="font-body text-xs text-ink-400">{error ?? hint}</p>
        </div>
      </div>
      {canToggle && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t('push_title')}
          disabled={busy}
          onClick={() => void toggle()}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-accent' : 'bg-line'}`}
        >
          <span aria-hidden className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`} />
        </button>
      )}
    </div>
  );
}
