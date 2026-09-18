'use client';

import type { SolanaTradeQuoteDto, SolanaTradeTransactionDto, TradeSide } from '@kamby/domain';
import { authedFetch, expectOk } from './session-client';

/**
 * Browser-side calls for Solana trading — see docs/TRADING.md#solana. Same contract as
 * trading-client.ts (the EVM counterpart): this file only ever asks the API to *prepare*
 * things (a quote, an unsigned transaction) or to *record* something the wallet already
 * did (a broadcast signature) — it never signs anything and never has access to a private
 * key. See docs/WALLET_SECURITY.md.
 */

export interface GetSolanaQuoteParams {
  side: TradeSide;
  tokenMint: string;
  walletAddress: string;
  amount: string;
  slippageBps: number;
  /** See SolanaTradeDto's own doc comment — 0/undefined omits Jito tip support entirely,
   *  same as the backend's own default. */
  jitoTipLamports?: number;
}

export async function getSolanaQuote(params: GetSolanaQuoteParams): Promise<SolanaTradeQuoteDto> {
  const res = await authedFetch('/solana/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await expectOk(res, 'get a quote');
  return res.json();
}

/**
 * The gas-sponsored counterpart to `getSolanaQuote` — see
 * `SolanaQuoteService#createSponsoredQuote`'s own doc comment (apps/api). Same request
 * shape (`jitoTipLamports` is simply unused on this path); the returned
 * `unsignedTxBase64` names the gas relayer, not the caller's own wallet, as fee payer — the
 * caller must sign only their own required signer slot and submit the result to
 * `submitSponsoredSolanaTransaction` below, never `submitSolanaTransaction`. Throws (via
 * `expectOk`) with a clear message if gas sponsorship isn't enabled on this deployment —
 * see docs/GAS_RELAYER_PLAN.md's "Status" for when that's expected to change.
 */
export async function getSponsoredSolanaQuote(params: GetSolanaQuoteParams): Promise<SolanaTradeQuoteDto> {
  const res = await authedFetch('/solana/quote/sponsored', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await expectOk(res, 'get a sponsored quote');
  return res.json();
}

export interface SubmitSolanaTransactionParams {
  quoteId: string;
  walletAddress: string;
  signature: string;
}

export async function submitSolanaTransaction(params: SubmitSolanaTransactionParams): Promise<SolanaTradeTransactionDto> {
  const res = await authedFetch('/solana/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await expectOk(res, 'record the submitted transaction');
  return res.json();
}

export interface SubmitSponsoredSolanaTransactionParams {
  quoteId: string;
  walletAddress: string;
  /** Base64-encoded `VersionedTransaction` bytes, signed only in the caller's own signer
   *  slot — never a bare signature string, unlike `submitSolanaTransaction` above, since
   *  nothing has been broadcast yet at this point: the gas relayer still owes its own
   *  co-signature (as fee payer) before this can go on-chain. See
   *  `GasRelayerService#submitSponsoredTransaction`'s own doc comment (apps/api). */
  partiallySignedTxBase64: string;
}

/** The gas-sponsored counterpart to `submitSolanaTransaction` — hands the relayer a
 *  partially-signed transaction to co-sign and broadcast itself, rather than recording a
 *  signature the caller already broadcast. Returns the same `SolanaTradeTransactionDto`
 *  shape either path produces, with `sponsoredByRelayer: true`. */
export async function submitSponsoredSolanaTransaction(params: SubmitSponsoredSolanaTransactionParams): Promise<SolanaTradeTransactionDto> {
  const res = await authedFetch('/solana/transactions/sponsored', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await expectOk(res, 'submit the sponsored transaction');
  return res.json();
}

/** Returns `null` for a 404 — same "doesn't exist or belongs to someone else,
 *  indistinguishably by design" contract as the EVM trading-client's getTransaction. */
export async function getSolanaTransaction(id: string): Promise<SolanaTradeTransactionDto | null> {
  const res = await authedFetch(`/solana/transactions/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  await expectOk(res, 'load transaction status');
  return res.json();
}

export interface SolanaTradeHistoryPage {
  items: SolanaTradeTransactionDto[];
  nextCursor: string | null;
}

export async function getSolanaTradeHistory(params: { cursor?: string; limit?: number } = {}): Promise<SolanaTradeHistoryPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/solana/history?${query.toString()}`);
  await expectOk(res, 'load trade history');
  return res.json();
}

/** Triggers the one-time new-wallet SOL top-up — see SolanaTopupService's own doc comment
 *  on the backend for why this is safe to call more than once. Called right after a
 *  wallet is newly verified. */
export async function ensureSolanaWalletFunded(address: string): Promise<{ toppedUp: boolean; signature: string | null }> {
  const res = await authedFetch(`/solana/wallet/${encodeURIComponent(address)}/topup`, { method: 'POST' });
  await expectOk(res, 'fund the new wallet');
  return res.json();
}
