'use client';

import type { TradeQuoteDto, TradeSide, TradeTransactionDto } from '@kamby/domain';
import { authedFetch, expectOk } from './session-client';

/**
 * Browser-side calls for Phase 3 trading — see docs/TRADING.md#quote-system and
 * #transaction-lifecycle. This file only ever asks the API to *prepare* things (a quote,
 * an unsigned transaction) or to *record* something the wallet already did (a broadcast
 * tx hash) — it never signs anything and never has access to a private key. See
 * docs/WALLET_SECURITY.md.
 */

export interface GetQuoteParams {
  /** Added 2026-09-16 for BNB Chain going live — every quote request used to implicitly
   *  resolve to whatever `DEFAULT_CHAIN_ID` this deployment's backend defaults to
   *  (Base) regardless of which chain the wallet/token were actually on, since this field
   *  never existed. Required, not optional: TradePanel.tsx always has a real chainId from
   *  its own required `chainId` prop, so there's no legitimate caller left that shouldn't
   *  send one. See `apps/api/src/trading/dto/quote-query.dto.ts`'s matching field. */
  chainId: number;
  side: TradeSide;
  tokenAddress: string;
  walletAddress: string;
  amount: string;
  slippageBps: number;
  /** Asks the EVM gas relayer to sponsor this trade — see docs/GAS_RELAYER_PLAN.md's EVM
   *  section. The response only carries `consentTypedData` when this is both `true` AND
   *  actually eligible; omitted (falsy) is indistinguishable from never having asked, by
   *  design — see `EvmGasRelayerQuoteService#attachSponsorshipIfEligible`'s own doc
   *  comment. Optional, defaults to no request sent (the existing self-paid behavior). */
  sponsorshipRequested?: boolean;
}

export async function getQuote(params: GetQuoteParams): Promise<TradeQuoteDto> {
  const query = new URLSearchParams({
    chainId: String(params.chainId),
    side: params.side,
    tokenAddress: params.tokenAddress,
    walletAddress: params.walletAddress,
    amount: params.amount,
    slippageBps: String(params.slippageBps),
  });
  if (params.sponsorshipRequested) query.set('sponsorshipRequested', 'true');
  const res = await authedFetch(`/trade/quote?${query.toString()}`);
  await expectOk(res, 'get a quote');
  return res.json();
}

export interface RelaySwapParams {
  quoteId: string;
  walletAddress: string;
  /** The EIP-712 signature over `quote.consentTypedData` — never constructed client-side,
   *  see docs/GAS_RELAYER_PLAN.md's EVM section. */
  signature: string;
}

/** Submits a sponsored trade for the relayer to broadcast — the gasless counterpart to
 *  `submitTransaction` above. Unlike that function, this client never broadcasts anything
 *  itself first; the server does, so there is no txHash to pass in and no separate
 *  record-failed retry state on the caller's side either — a plain retry is always safe,
 *  see `EvmGasRelayerQuoteService#relay`'s own doc comment on why this is idempotent on
 *  `quoteId`. */
export async function relaySwap(params: RelaySwapParams): Promise<TradeTransactionDto> {
  const res = await authedFetch('/trade/relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await expectOk(res, 'relay the sponsored trade');
  return res.json();
}

export interface SubmitTransactionParams {
  quoteId: string;
  walletAddress: string;
  txHash: string;
}

export async function submitTransaction(params: SubmitTransactionParams): Promise<TradeTransactionDto> {
  const res = await authedFetch('/trade/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await expectOk(res, 'record the submitted transaction');
  return res.json();
}

/** Records the separate USDC fee-transfer transaction alongside an already-submitted
 *  trade — see docs/TRADING.md#guaranteed-usdc-fees. Only ever called when the quote's
 *  own `feeUnsignedTx` was non-null; the wallet signs and broadcasts it exactly like the
 *  swap itself, this just tells the backend what hash to watch. */
export async function submitFeeTransaction(transactionId: string, txHash: string): Promise<TradeTransactionDto> {
  const res = await authedFetch(`/trade/transactions/${encodeURIComponent(transactionId)}/fee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHash }),
  });
  await expectOk(res, 'record the fee transfer');
  return res.json();
}

/** Returns `null` for a 404 — either the id doesn't exist or (indistinguishably, by
 *  design) it belongs to someone else. See docs/TRADING.md#authorization. */
export async function getTransaction(id: string): Promise<TradeTransactionDto | null> {
  const res = await authedFetch(`/trade/transactions/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  await expectOk(res, 'load transaction status');
  return res.json();
}

export interface TradeHistoryPage {
  items: TradeTransactionDto[];
  nextCursor: string | null;
}

export async function getTradeHistory(params: { cursor?: string; limit?: number } = {}): Promise<TradeHistoryPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/trade/history?${query.toString()}`);
  await expectOk(res, 'load trade history');
  return res.json();
}
