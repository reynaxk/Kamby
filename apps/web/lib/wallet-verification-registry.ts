/**
 * Shared, page-lifetime state behind automatic wallet verification (useWalletVerification /
 * useSolanaWalletVerification). Several components mount those hooks at once — the header's
 * sign-in button and a trade panel, say — and each would otherwise start its own challenge
 * and ask the wallet to sign twice. Here, per wallet key (`evm:0x…` / `solana:…`):
 *
 * - at most one verification runs at a time; a second caller joins it,
 * - a success is visible to every mounted hook instance immediately,
 * - the *automatic* attempt happens once per page load, so a user who declines a signature
 *   (possible with an external wallet like MetaMask) isn't re-prompted in a loop — they get a
 *   manual "Try again" instead.
 */
const verified = new Set<string>();
const inFlight = new Map<string, Promise<void>>();
const autoAttempted = new Set<string>();
const listeners = new Set<(key: string) => void>();

export function isVerified(key: string): boolean {
  return verified.has(key);
}

export function markVerified(key: string): void {
  verified.add(key);
  for (const listener of listeners) listener(key);
}

/** Calls `onVerified(key)` whenever any hook instance verifies a wallet. */
export function onVerified(listener: (key: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs `verify` for `key`, or joins the run already in progress. */
export function verifyOnce(key: string, verify: () => Promise<void>): Promise<void> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = verify()
    .then(() => markVerified(key))
    .finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

/** True the first time it's asked for a key this page load — gates the automatic attempt. */
export function claimAutoAttempt(key: string): boolean {
  if (autoAttempted.has(key)) return false;
  autoAttempted.add(key);
  return true;
}

/** Test seam. */
export function resetWalletVerificationRegistry(): void {
  verified.clear();
  inFlight.clear();
  autoAttempted.clear();
  listeners.clear();
}
