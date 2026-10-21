import { getTranslations } from 'next-intl/server';

/** Shown instead of Perps where Hyperliquid doesn't serve (see lib/perps-region.ts). */
export async function PerpsBlocked() {
  const t = await getTranslations('perps');
  return (
    <div className="kamby-glass mt-6 flex flex-col items-center rounded-3xl px-6 py-12 text-center">
      <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-ink-400">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M4.9 4.9l14.2 14.2" />
        </svg>
      </span>
      <p className="mt-4 font-display text-base font-bold text-ink-900">{t('blockedTitle')}</p>
      <p className="mt-1 max-w-sm font-body text-sm text-ink-400">{t('blockedBody')}</p>
    </div>
  );
}
