import { errorText, translateApiMessage, type ErrorKey } from './error-messages';

/**
 * What a user sees when something fails (2026-10-04 audit): never a raw library dump, stack
 * trace, HTTP status or JSON. Wallet libraries (viem, Privy, Solana web3) throw long technical
 * messages ("User rejected the request. Request Arguments: from: 0x… Version: viem@2…"); the
 * API's own messages are already written for people and pass through when they look like it.
 * Shown in the page's language (lib/error-messages.ts) since 2026-10-09.
 */
const RULES: { test: RegExp; key: ErrorKey }[] = [
  { test: /user (rejected|denied|cancel)|rejected the request|request rejected|cancelled by user|user closed/i, key: 'cancelled' },
  { test: /insufficient (funds|balance|lamports)|exceeds (the )?balance|not enough (funds|balance)/i, key: 'balance' },
  { test: /blockhash not found|block height exceeded|transaction expired|expired blockhash/i, key: 'expired' },
  { test: /\b429\b|too many requests|rate.?limit/i, key: 'rateLimit' },
  { test: /failed to fetch|networkerror|network request failed|load failed|timed? ?out|timeout|econn|socket hang up/i, key: 'network' },
  { test: /\((5\d\d)\)|internal server error|bad gateway|service unavailable/i, key: 'server' },
];

/** Looks like a sentence meant for people: short, one line, no code-ish fragments. */
function isHumanReadable(message: string): boolean {
  return (
    message.length > 0 &&
    message.length <= 160 &&
    !message.includes('\n') &&
    !/0x[0-9a-f]{16,}|[1-9A-HJ-NP-Za-km-z]{40,}|\bat \S+ \(|Version: |Request Arguments|Details:|\{|\}|undefined|null|NaN|\(\d{3}\)/i.test(message)
  );
}

export function friendlyError(err: unknown, fallback?: string): string {
  const short =
    err && typeof err === 'object' && 'shortMessage' in err && typeof (err as { shortMessage?: unknown }).shortMessage === 'string'
      ? (err as { shortMessage: string }).shortMessage
      : null;
  const message = short ?? (err instanceof Error ? err.message : typeof err === 'string' ? err : '');
  for (const rule of RULES) if (rule.test.test(message)) return errorText(rule.key);
  return isHumanReadable(message) ? translateApiMessage(message) : (fallback ?? errorText('fallback'));
}
