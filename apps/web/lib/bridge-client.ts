'use client';

import { authedFetch } from './session-client';

/** The chains Kamby moves a user's USDC between (see apps/api bridge/BridgeService). */
export type BridgeChain = 'base' | 'bnb' | 'solana';

export interface BridgeQuote {
  requestId: string;
  from: BridgeChain;
  to: BridgeChain;
  amountIn: string;
  amountOut: string;
  feeUsd: number;
  timeEstimateSeconds: number;
  steps: { id: string; to: string; data: string; value: string; chainId: number; gas: string | null }[];
  /** Moves out of Solana: the deposit transaction (Kamby pays its fee) for the user to sign. */
  solanaTxBase64: string | null;
}

export type MoveStatus = 'waiting' | 'depositing' | 'pending' | 'success' | 'failure' | 'refund' | 'unknown';

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (body.message) return Array.isArray(body.message) ? body.message[0]! : body.message;
  } catch {
    // keep the fallback
  }
  return fallback;
}

/** A quote for moving USDC so that exactly `amountOut` (raw, `to`'s decimals) lands on `to`. */
export async function quoteMove(params: { from: BridgeChain; to: BridgeChain; amountOut: string }): Promise<BridgeQuote> {
  const res = await authedFetch('/bridge/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `Couldn't prepare the move (${res.status})`));
  return res.json();
}

export async function moveStatus(requestId: string): Promise<MoveStatus> {
  const res = await authedFetch(`/bridge/status/${encodeURIComponent(requestId)}`);
  if (!res.ok) return 'unknown';
  const body = (await res.json()) as { status?: MoveStatus };
  return body.status ?? 'unknown';
}

/** Hands the user-signed Solana move back for Kamby's relayer to co-sign (fee only) and send. */
export async function submitSolanaMove(requestId: string, signedTxBase64: string): Promise<{ signature: string }> {
  const res = await authedFetch('/bridge/solana/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, signedTxBase64 }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `Couldn't send the move (${res.status})`));
  return res.json();
}
