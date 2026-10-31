'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getNewsAlertPrefs, onNewsAlertPrefsChange, setNewsAlertPrefs, type NewsAlertPrefs } from '@/lib/news-client';

/** The two news-alert switches (this browser): alerts on/off, and their sound. */
export function NewsAlertSettings() {
  const t = useTranslations('news');
  const [prefs, setPrefs] = useState<NewsAlertPrefs | null>(null);

  useEffect(() => {
    setPrefs(getNewsAlertPrefs());
    return onNewsAlertPrefsChange(setPrefs);
  }, []);

  if (!prefs) return null;

  const rows: { key: keyof NewsAlertPrefs; label: string; detail: string; disabled?: boolean }[] = [
    { key: 'toasts', label: t('alertsTitle'), detail: t('alertsDetail') },
    { key: 'sound', label: t('soundTitle'), detail: t('soundDetail'), disabled: !prefs.toasts },
  ];

  return (
    <>
      {rows.map(({ key, label, detail, disabled }) => {
        const on = prefs[key] && !disabled;
        return (
          <div key={key} className="flex items-center justify-between gap-4 px-3 py-3">
            <div className="min-w-0">
              <p className="font-body text-sm font-medium text-ink-900">{label}</p>
              <p className="font-body text-xs text-ink-400">{detail}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={label}
              disabled={disabled}
              onClick={() => setNewsAlertPrefs({ ...prefs, [key]: !prefs[key] })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-accent' : 'bg-line'}`}
            >
              <span aria-hidden className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`} />
            </button>
          </div>
        );
      })}
    </>
  );
}
