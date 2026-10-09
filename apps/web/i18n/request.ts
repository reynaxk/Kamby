import { cookies, headers } from 'next/headers';
import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale, localeFromAcceptLanguage, LOCALE_COOKIE, type Locale } from './config';

/** next-intl without i18n routing: the cookie first, else the browser's language. */
export default getRequestConfig(async () => {
  const fromCookie = cookies().get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(fromCookie) ? fromCookie : localeFromAcceptLanguage(headers().get('accept-language'));
  const messages = (await import(`../messages/${locale}.json`)).default;
  // Anything a language hasn't translated yet falls back to English rather than showing a key.
  const english = locale === DEFAULT_LOCALE ? messages : (await import('../messages/en.json')).default;
  return { locale, messages: deepMerge(english, messages) as AbstractIntlMessages };
});

function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const prev = out[key];
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && prev && typeof prev === 'object'
        ? deepMerge(prev as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}
