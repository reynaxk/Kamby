'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * A phone screen's top bar with a back arrow (2026-10-10 app mode) — the screens you open from
 * Profile or a leaderboard row had no site header any more, so no way back but the tab bar.
 * Goes back in history, or to `fallback` when the screen was opened directly. Phones only.
 */
export function AppBackBar({ title, fallback = '/home' }: { title?: string; fallback?: string }) {
  const router = useRouter();
  const tU = useTranslations('ui');
  return (
    <div className="sticky top-0 z-40 flex items-center gap-1 bg-bg/90 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl md:hidden">
      <button
        type="button"
        aria-label={tU('back_0557')}
        onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 active:bg-white/10"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      {title && <h1 className="truncate font-display text-lg font-bold text-ink-900">{title}</h1>}
    </div>
  );
}
