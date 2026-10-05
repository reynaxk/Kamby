/**
 * What a user sees when something fails (2026-10-04 audit): never a raw library dump, stack
 * trace, HTTP status or JSON. Wallet libraries (viem, Privy, Solana web3) throw long technical
 * messages ("User rejected the request. Request Arguments: from: 0x… Version: viem@2…"); the
 * API's own messages are already written for people and pass through when they look like it.
 */
const RULES: { test: RegExp; message: string }[] = [
  { test: /user (rejected|denied|cancel)|rejected the request|request rejected|cancelled by user|user closed/i, message: 'You cancelled this in your wallet — nothing was sent.' },
  { test: /insufficient (funds|balance|lamports)|exceeds (the )?balance|not enough (funds|balance)/i, message: 'Not enough balance for this trade.' },
  { test: /blockhash not found|block height exceeded|transaction expired|expired blockhash/i, message: 'The network took too long and this trade expired — nothing was charged. Please try again.' },
  { test: /\b429\b|too many requests|rate.?limit/i, message: 'Too many requests right now — wait a few seconds and try again.' },
  { test: /failed to fetch|networkerror|network request failed|load failed|timed? ?out|timeout|econn|socket hang up/i, message: 'Connection problem — check your internet and try again.' },
  { test: /\((5\d\d)\)|internal server error|bad gateway|service unavailable/i, message: 'Something went wrong on our side — please try again in a moment.' },
];

const FALLBACK = 'Something went wrong — please try again.';

/** Looks like a sentence meant for people: short, one line, no code-ish fragments. */
function isHumanReadable(message: string): boolean {
  return (
    message.length > 0 &&
    message.length <= 160 &&
    !message.includes('\n') &&
    !/0x[0-9a-f]{16,}|[1-9A-HJ-NP-Za-km-z]{40,}|\bat \S+ \(|Version: |Request Arguments|Details:|\{|\}|undefined|null|NaN|\(\d{3}\)/i.test(message)
  );
}

export function friendlyError(err: unknown, fallback = FALLBACK): string {
  const short =
    err && typeof err === 'object' && 'shortMessage' in err && typeof (err as { shortMessage?: unknown }).shortMessage === 'string'
      ? (err as { shortMessage: string }).shortMessage
      : null;
  const message = short ?? (err instanceof Error ? err.message : typeof err === 'string' ? err : '');
  for (const rule of RULES) if (rule.test.test(message)) return rule.message;
  return isHumanReadable(message) ? message : fallback;
}
