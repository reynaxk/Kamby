import { headers } from 'next/headers';

/**
 * Where Perps can't be offered (2026-10-21): Hyperliquid itself refuses users from the United
 * States and comprehensively sanctioned countries, so Kamby doesn't show them there either.
 * Cloudflare puts the visitor's country in `cf-ipcountry` on every request.
 */
export const PERPS_BLOCKED_COUNTRIES = new Set(['US', 'CU', 'IR', 'KP', 'SY']);

export function perpsBlockedHere(): boolean {
  const country = headers().get('cf-ipcountry')?.toUpperCase();
  return Boolean(country && PERPS_BLOCKED_COUNTRIES.has(country));
}
