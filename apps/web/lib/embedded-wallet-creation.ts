/**
 * The one place Kamby asks Privy to create an embedded wallet (2026-09-30). Wallet creation
 * used to be triggered independently by every mounted ConnectWalletButton (the header's and a
 * trade panel's) and by SolanaTradePanel — harmless while every user already had wallets, but
 * on the new Privy app every user is new, so a sign-in fired several createWallet() calls at
 * once and Privy's modal hung on "Creating your wallet" for minutes.
 *
 * Now, for the whole page: at most one creation per chain is ever in flight (later callers
 * join it), and the two chains never run at the same time (EVM, then Solana). A failed
 * attempt is not remembered, so a retry really retries.
 */
export type EmbeddedWalletKind = 'ethereum' | 'solana';

const inFlight = new Map<EmbeddedWalletKind, Promise<unknown>>();
/** Kinds already created on this page — Privy's wallet list can lag the creation, and a
 *  second createWallet() for a user who now has one errors. */
const created = new Set<EmbeddedWalletKind>();
let queue: Promise<unknown> = Promise.resolve();

export function createEmbeddedWalletOnce(kind: EmbeddedWalletKind, create: () => Promise<unknown>): Promise<void> {
  if (created.has(kind)) return Promise.resolve();
  const existing = inFlight.get(kind);
  if (existing) return existing.then(() => undefined);
  const run = queue.catch(() => undefined).then(create);
  queue = run.catch(() => undefined);
  inFlight.set(kind, run);
  void run
    .then(() => created.add(kind))
    .catch(() => undefined)
    .finally(() => inFlight.delete(kind));
  return run.then(() => undefined);
}

/** How long "Setting up your wallet…" may show before a "Try again" is offered. */
export const WALLET_SETUP_SLOW_MS = 30_000;

/** Test seam. */
export function resetEmbeddedWalletCreation(): void {
  inFlight.clear();
  created.clear();
  queue = Promise.resolve();
}
