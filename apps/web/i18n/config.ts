/**
 * Kamby's languages (owner request 2026-10-09: 14 languages for web + app). The locale lives in a
 * cookie — no /xx/ URL prefixes, so every existing link keeps working — and the first visit picks
 * the browser's language when Kamby has it. Legal pages (Terms, Privacy) stay English: the
 * English text is the binding one.
 */
export const LOCALES = ['en', 'zh', 'ko', 'ja', 'tr', 'ru', 'es', 'pt', 'vi', 'id', 'th', 'de', 'fr', 'bg'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Each language in its own name, for the picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  ko: '한국어',
  ja: '日本語',
  tr: 'Türkçe',
  ru: 'Русский',
  es: 'Español',
  pt: 'Português',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
  th: 'ไทย',
  de: 'Deutsch',
  fr: 'Français',
  bg: 'Български',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The best supported locale for an Accept-Language header ("zh-CN,zh;q=0.9,en;q=0.8"). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { lang: (tag ?? '').toLowerCase().split('-')[0] ?? '', q: q ? Number(q) : 1 };
    })
    .filter((x) => x.lang && Number.isFinite(x.q))
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) if (isLocale(lang)) return lang;
  return DEFAULT_LOCALE;
}
