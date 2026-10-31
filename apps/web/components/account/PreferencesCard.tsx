'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { LanguageSelect } from '@/components/i18n/LanguageSelect';
import { setTickerEnabled, useTickerEnabled } from '@/lib/ticker-pref';
import { useBalanceVisibility } from './BalanceVisibilityContext';
import { NewsAlertSettings } from '@/components/news/NewsAlertSettings';

/** An iOS-style switch in Kamby's accent. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', on ? 'bg-accent' : 'bg-white/[0.12]')}
    >
      <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.35)] transition-[left] duration-200 ease-out', on ? 'left-6' : 'left-1')} />
    </button>
  );
}

function Row({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3.5 py-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.04] text-accent" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-sm font-bold text-ink-900">{title}</span>
        <span className="mt-0.5 block font-body text-xs leading-snug text-ink-400">{hint}</span>
      </span>
      {children}
    </li>
  );
}

const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/**
 * The profile's Settings card (2026-10-18, owner: "it doesn't look cool there") — one clean list
 * of switches instead of buttons scattered under the wallet: the bottom coin ticker, hiding
 * balances, and the language.
 */
export function PreferencesCard({ className }: { className?: string }) {
  const t = useTranslations('account');
  const ticker = useTickerEnabled();
  const { hidden, toggle } = useBalanceVisibility();
  return (
    <section aria-labelledby="settings-heading" className={cn('rounded-2xl border border-line bg-surface px-4 pt-4', className)}>
      <h2 id="settings-heading" className="font-display text-sm font-semibold text-ink-900">
        {t('settings')}
      </h2>
      <ul className="mt-1 divide-y divide-white/[0.05]">
        <Row icon={icon('M3 17l6-6 4 4 8-8M15 7h6v6')} title={t('ticker')} hint={t('tickerHint')}>
          <Switch on={ticker} onChange={setTickerEnabled} label={t('ticker')} />
        </Row>
        <Row icon={icon('M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 1 12s4 8 11 8a9.26 9.26 0 0 0 5.39-1.61M1 1l22 22')} title={t('hideTitle')} hint={t('hideHint')}>
          <Switch on={hidden} onChange={() => toggle()} label={t('hideTitle')} />
        </Row>
        <Row icon={icon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18')} title={t('languageTitle')} hint={t('languageHint')}>
          <LanguageSelect bare className="w-auto min-w-[9rem] max-w-[13rem] shrink-0" />
        </Row>
        <li className="-mx-3">
          <NewsAlertSettings />
        </li>
      </ul>
    </section>
  );
}
