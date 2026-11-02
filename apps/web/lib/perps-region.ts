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

/** Perps is months away (owner 2026-11-02): the pages send people to Hunt until this is true. */
export const PERPS_OPEN = false;
