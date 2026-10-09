'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@kamby/ui';
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, type Locale } from '@/i18n/config';

/** Language picker — saves the choice in a cookie (a year) and re-renders in that language. */
export function LanguageSelect({ className }: { className?: string }) {
  const t = useTranslations('language');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className={cn('flex items-center gap-2 font-body text-sm text-ink-600', className)}>
      <span className="shrink-0">{t('label')}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(event) => {
          document.cookie = `${LOCALE_COOKIE}=${event.target.value}; path=/; max-age=31536000; samesite=lax`;
          startTransition(() => router.refresh());
        }}
        className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 font-body text-sm text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
