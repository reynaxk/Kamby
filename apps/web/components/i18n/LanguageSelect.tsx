'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { cn } from '@kamby/ui';
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, type Locale } from '@/i18n/config';
import { Flag } from './Flag';

/** Each language named in the reader's current language ("Немски" for de when you read Bulgarian). */
function localName(code: Locale, inLocale: Locale): string {
  try {
    const name = new Intl.DisplayNames([inLocale], { type: 'language' }).of(code) ?? '';
    return name.charAt(0).toLocaleUpperCase(inLocale) + name.slice(1);
  } catch {
    return '';
  }
}

/**
 * The language picker (2026-10-18, owner: make it cool) — a pill with the flag and the language's
 * own name; tap it for a glass sheet with every language as a card (flag, its own
 * name, and its name in yours). The choice is saved in a cookie for a year and the page
 * re-renders in place. Used on the sign-in screen, the profile and the footer.
 *
 * `bare` = no "Language" label beside the pill (a settings row already shows one).
 */
export function LanguageSelect({ className, bare = false }: { className?: string; bare?: boolean }) {
  const t = useTranslations('language');
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('flex items-center gap-2 font-body text-sm text-ink-600', className)}>
      {!bare && <span className="shrink-0">{t('label')}</span>}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${t('label')}: ${LOCALE_NAMES[locale]}`}
        className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Flag locale={locale} />
        <span className="min-w-0 flex-1 truncate font-body text-sm font-semibold text-ink-900">{LOCALE_NAMES[locale]}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-400 transition-transform group-hover:translate-y-px" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <LanguageSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function LanguageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('language');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Locale | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Close once the page has re-rendered in the new language.
  useEffect(() => {
    if (picked && !pending && picked === locale) {
      setPicked(null);
      onClose();
    }
  }, [picked, pending, locale, onClose]);

  const rows = useMemo(
    () =>
      LOCALES.map((code) => ({ code, own: LOCALE_NAMES[code], local: localName(code, locale) })),
    [locale],
  );

  function choose(code: Locale) {
    if (code === locale) {
      onClose();
      return;
    }
    try {
      navigator.vibrate?.(8);
    } catch {
      // not supported
    }
    setPicked(code);
    document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="kamby-void fixed inset-0 z-[120] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={t('label')}>
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            initial={{ y: 40, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            className="kamby-glass-solid relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-[2rem] border-b-0 sm:max-w-xl sm:rounded-[2rem] sm:border-b"
          >
            <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" />
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <div>
                <p className="font-display text-lg font-black tracking-tight text-ink-900">{t('label')}</p>
                <p className="font-body text-xs text-ink-400">{t('pickerHint', { count: LOCALES.length })}</p>
              </div>
              <button type="button" onClick={onClose} aria-label={t('close')} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-ink-600 transition-colors hover:bg-white/10">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-2 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-2 sm:grid-cols-3">
              {rows.map((r) => {
                const current = r.code === locale;
                const loading = picked === r.code && pending;
                return (
                  <li key={r.code}>
                    <button
                      type="button"
                      onClick={() => choose(r.code)}
                      disabled={pending}
                      lang={r.code}
                      className={cn(
                        'relative flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-[transform,background-color,border-color] duration-150 active:scale-[0.97]',
                        current ? 'border-accent/60 bg-accent/[0.08]' : 'border-white/[0.06] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]',
                        pending && !loading && 'opacity-50',
                      )}
                    >
                      <Flag locale={r.code} className="h-[19px] w-[28px]" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 break-words font-display text-[0.9rem] font-bold leading-tight text-ink-900">{r.own}</span>
                        {r.local && r.local !== r.own && <span className="block truncate font-body text-[0.68rem] text-ink-400">{r.local}</span>}
                      </span>
                      {loading ? (
                        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
                      ) : current ? (
                        <span className="kamby-pop absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-black ring-2 ring-[#0B0F18]" aria-label={t('current')}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
