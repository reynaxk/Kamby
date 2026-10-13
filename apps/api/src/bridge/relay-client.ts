/**
 * A thin client for Relay (api.relay.link) — the bridge Kamby moves a user's USDC between
 * Solana, Base and BNB Chain with (owner decision 2026-10-13: one USDC, no chains to think
 * about). Relay is an intent/solver network: the user deposits on the origin chain and a
 * solver fills on the destination, typically within seconds. Non-custodial: Relay returns the
 * transactions; the user's own wallet signs them.
 */

export const RELAY_API_URL = 'https://api.relay.link';
const TIMEOUT_MS = 10_000;

/** Relay's own chain ids. Solana has a Relay-specific id. */
export const RELAY_CHAIN_ID = { base: 8453, bnb: 56, solana: 792703809 } as const;
export type BridgeChain = keyof typeof RELAY_CHAIN_ID;

export interface RelayTxItem {
  from?: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface RelayStep {
  id: string;
  kind: 'transaction' | 'signature';
  items: { status: string; data: RelayTxItem | Record<string, unknown> }[];
}

export interface RelayQuote {
  requestId?: string;
  steps: RelayStep[];
  fees: Record<string, { amount?: string; amountUsd?: string } | undefined>;
  details?: {
    currencyIn?: { amount?: string; amountUsd?: string };
    currencyOut?: { amount?: string; amountUsd?: string };
    timeEstimate?: number;
  };
}

export type RelayStatus = 'waiting' | 'depositing' | 'pending' | 'success' | 'failure' | 'refund' | 'unknown';

export interface RelayQuoteRequest {
  user: string;
  recipient: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: string;
  tradeType: 'EXACT_INPUT' | 'EXACT_OUTPUT';
  depositFeePayer?: string;
}

export class RelayError extends Error {}

export class RelayClient {
  constructor(
    private readonly apiKey: string | null,
    private readonly baseUrl: string = RELAY_API_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}) };
  }

  async quote(request: RelayQuoteRequest): Promise<RelayQuote> {
    const res = await this.fetchImpl(`${this.baseUrl}/quote/v2`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as (RelayQuote & { message?: string }) | null;
    if (!res.ok || !body || !Array.isArray(body.steps)) {
      throw new RelayError(body?.message ?? `Relay quote failed (${res.status})`);
    }
    return body;
  }

  async status(requestId: string): Promise<RelayStatus> {
    const res = await this.fetchImpl(`${this.baseUrl}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new RelayError(`Relay status failed (${res.status})`);
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    const status = body?.status;
    return status === 'waiting' || status === 'depositing' || status === 'pending' || status === 'success' || status === 'failure' || status === 'refund'
      ? status
      : 'unknown';
  }
}
