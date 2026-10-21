'use client';

import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid';
import type { Candle } from '@kamby/domain';
import { parseSignature } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getAccount, getWalletClient, sendTransaction, switchChain, waitForTransactionReceipt } from 'wagmi/actions';
import { wagmiConfig } from './wagmi-config';

/**
 * ⚡ Perps on Hyperliquid (owner, 2026-10-21) — everything here talks to Hyperliquid directly
 * from the browser: its public info API for markets and accounts, and its exchange API for
 * orders. Non-custodial: the user's own wallet signs once to approve a trading key ("agent")
 * that lives only in this browser and can trade but never withdraw, plus Kamby's builder fee;
 * after that every order is one tap with no wallet popup. Money moves in and out through Relay
 * (Kamby's one USDC balance ↔ Hyperliquid perps USDC).
 */

const transport = new HttpTransport();
export const hlInfo = new InfoClient({ transport });

/** Kamby's builder fee: 50 = 5 basis points = 0.05% of each trade's notional (owner's pick). */
export const BUILDER_FEE_TENTHS_BP = 50;
export const BUILDER_MAX_FEE_RATE = '0.05%';
/** Where the builder fee lands — Kamby's fee wallet (same as the swap fee). */
export const BUILDER_ADDRESS = (process.env.NEXT_PUBLIC_PERPS_BUILDER_ADDRESS ?? '0xa3c08b3b8abc6810fcd12f29f0e644ab70b3fe80') as `0x${string}`;
/** Hyperliquid's own taker fee (base tier), shown in the trade summary. */
export const HL_TAKER_FEE = 0.00045;
/** A market order is an IOC limit this far through the mark — Hyperliquid's own convention. */
const MARKET_SLIPPAGE = 0.05;
/** Relay's ~$1.20 fixed cost makes small deposits wasteful. */
export const MIN_DEPOSIT_USD = 10;
export const MIN_WITHDRAW_USD = 2;

export interface PerpMarket {
  coin: string;
  /** Index in Hyperliquid's universe — the `a` field of an order. */
  asset: number;
  szDecimals: number;
  maxLeverage: number;
  markPx: number;
  prevDayPx: number;
  change24hPct: number;
  volume24hUsd: number;
  openInterestUsd: number;
  /** Hourly funding rate (0.0001 = 0.01%/h). */
  funding: number;
}

/** Every live perp market, busiest first. */
export async function fetchPerpMarkets(): Promise<PerpMarket[]> {
  const [meta, ctxs] = await hlInfo.metaAndAssetCtxs();
  const rows: PerpMarket[] = [];
  meta.universe.forEach((u, i) => {
    const c = ctxs[i];
    if (!c || (u as { isDelisted?: boolean }).isDelisted) return;
    const markPx = Number(c.markPx);
    const prevDayPx = Number(c.prevDayPx);
    rows.push({
      coin: u.name,
      asset: i,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
      markPx,
      prevDayPx,
      change24hPct: prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0,
      volume24hUsd: Number(c.dayNtlVlm),
      openInterestUsd: Number(c.openInterest) * markPx,
      funding: Number(c.funding),
    });
  });
  return rows.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
}

export type PerpInterval = '5m' | '15m' | '1h' | '4h' | '1d';
const INTERVAL_MS: Record<PerpInterval, number> = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };

/** ~150 candles for the chart, in Kamby's Candle shape. */
export async function fetchPerpCandles(coin: string, interval: PerpInterval): Promise<Candle[]> {
  const rows = await hlInfo.candleSnapshot({ coin, interval, startTime: Date.now() - INTERVAL_MS[interval] * 150 });
  return rows.map((r) => ({
    bucketStart: new Date(r.t).toISOString(),
    open: Number(r.o),
    high: Number(r.h),
    low: Number(r.l),
    close: Number(r.c),
    volumeUsd: Number(r.v) * Number(r.c),
  }));
}

export interface PerpPosition {
  coin: string;
  /** Signed size: positive = long, negative = short. */
  size: number;
  entryPx: number;
  positionValueUsd: number;
  unrealizedPnlUsd: number;
  returnOnEquityPct: number;
  liquidationPx: number | null;
  leverage: number;
  marginUsd: number;
}

export interface PerpAccount {
  accountValueUsd: number;
  withdrawableUsd: number;
  positions: PerpPosition[];
}

export async function fetchPerpAccount(user: string): Promise<PerpAccount> {
  const s = await hlInfo.clearinghouseState({ user: user as `0x${string}` });
  return {
    accountValueUsd: Number(s.marginSummary.accountValue),
    withdrawableUsd: Number(s.withdrawable),
    positions: s.assetPositions.map(({ position: p }) => ({
      coin: p.coin,
      size: Number(p.szi),
      entryPx: Number(p.entryPx),
      positionValueUsd: Number(p.positionValue),
      unrealizedPnlUsd: Number(p.unrealizedPnl),
      returnOnEquityPct: Number(p.returnOnEquity) * 100,
      liquidationPx: p.liquidationPx === null ? null : Number(p.liquidationPx),
      leverage: Number(p.leverage.value),
      marginUsd: Number(p.marginUsed),
    })),
  };
}

// --- the trading key ("agent") -----------------------------------------------------------

const agentKey = (master: string) => `kamby:hl-agent:${master.toLowerCase()}`;

/** This browser's trading key for `master`, if it set one up. */
export function storedAgent(master: string): `0x${string}` | null {
  try {
    const k = window.localStorage.getItem(agentKey(master));
    return k && /^0x[0-9a-f]{64}$/i.test(k) ? (k as `0x${string}`) : null;
  } catch {
    return null;
  }
}

/** The user's own wallet (Privy/wagmi), shaped for the SDK's user-signed actions. */
async function masterWallet() {
  const client = await getWalletClient(wagmiConfig);
  if (!client) throw new Error('Your wallet is still being set up — try again in a moment.');
  return client;
}

/**
 * One-time setup: the user's wallet approves a fresh trading key for this browser and Kamby's
 * builder fee (two signatures, no gas). Needs a funded Hyperliquid account — deposit first.
 */
export async function enableTrading(master: string): Promise<void> {
  const wallet = await masterWallet();
  const exchange = new ExchangeClient({ transport, wallet });
  const fees = await hlInfo.maxBuilderFee({ user: master as `0x${string}`, builder: BUILDER_ADDRESS }).catch(() => 0);
  if (Number(fees) < BUILDER_FEE_TENTHS_BP) await exchange.approveBuilderFee({ builder: BUILDER_ADDRESS, maxFeeRate: BUILDER_MAX_FEE_RATE });
  const key = generatePrivateKey();
  await exchange.approveAgent({ agentAddress: privateKeyToAccount(key).address, agentName: 'kamby' });
  window.localStorage.setItem(agentKey(master), key);
}

function agentExchange(master: string): ExchangeClient {
  const key = storedAgent(master);
  if (!key) throw new Error('Enable 1-tap trading first.');
  return new ExchangeClient({ transport, wallet: privateKeyToAccount(key) });
}

/** Hyperliquid prices: at most 5 significant figures and (6 − szDecimals) decimals. */
export function roundPerpPrice(px: number, szDecimals: number): string {
  const maxDecimals = Math.max(0, 6 - szDecimals);
  const sig = Number(px.toPrecision(5));
  return Number(sig.toFixed(maxDecimals)).toString();
}

/** A size rounded down to the market's lot (never more than the margin allows). */
export function roundPerpSize(size: number, szDecimals: number): string {
  const f = 10 ** szDecimals;
  return (Math.floor(size * f) / f).toFixed(szDecimals);
}

/** Rough liquidation price for an isolated position (Hyperliquid shows the exact one after). */
export function estimateLiqPx(entry: number, leverage: number, isLong: boolean, maxLeverage: number): number {
  const mmr = 1 / (2 * maxLeverage);
  return isLong ? entry * (1 - 1 / leverage + mmr) : entry * (1 + 1 / leverage - mmr);
}

function orderError(res: unknown): string | null {
  const statuses = (res as { response?: { data?: { statuses?: unknown[] } } })?.response?.data?.statuses ?? [];
  for (const s of statuses) if (s && typeof s === 'object' && 'error' in s) return String((s as { error: unknown }).error);
  return null;
}

/** Open a position at market: `marginUsd` × `leverage`, isolated, with Kamby's builder fee. */
export async function openPerp(master: string, market: PerpMarket, isLong: boolean, marginUsd: number, leverage: number): Promise<void> {
  const exchange = agentExchange(master);
  await exchange.updateLeverage({ asset: market.asset, isCross: false, leverage });
  const size = roundPerpSize((marginUsd * leverage) / market.markPx, market.szDecimals);
  if (!(Number(size) > 0)) throw new Error('That amount is too small for this market.');
  const px = roundPerpPrice(market.markPx * (isLong ? 1 + MARKET_SLIPPAGE : 1 - MARKET_SLIPPAGE), market.szDecimals);
  const res = await exchange.order({
    orders: [{ a: market.asset, b: isLong, p: px, s: size, r: false, t: { limit: { tif: 'FrontendMarket' } } }],
    grouping: 'na',
    builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP },
  });
  const err = orderError(res);
  if (err) throw new Error(err);
}

/** Close a whole position at market (reduce-only). */
export async function closePerp(master: string, market: PerpMarket, position: PerpPosition): Promise<void> {
  const exchange = agentExchange(master);
  const isLong = position.size > 0;
  const px = roundPerpPrice(market.markPx * (isLong ? 1 - MARKET_SLIPPAGE : 1 + MARKET_SLIPPAGE), market.szDecimals);
  const res = await exchange.order({
    orders: [{ a: market.asset, b: !isLong, p: px, s: Math.abs(position.size).toFixed(market.szDecimals), r: true, t: { limit: { tif: 'FrontendMarket' } } }],
    grouping: 'na',
    builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP },
  });
  const err = orderError(res);
  if (err) throw new Error(err);
}

// --- money in and out (Relay) --------------------------------------------------------------

const RELAY = 'https://api.relay.link';
const HL_CHAIN = 1337;
const HL_PERPS_USDC = '0x00000000000000000000000000000000';
export const PERPS_SOURCES = [
  { chainId: 8453, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, slug: 'base' as const },
  { chainId: 56, usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, slug: 'bnb' as const },
];

interface RelayStep {
  id: string;
  kind: 'transaction' | 'signature';
  requestId?: string;
  items: { data: Record<string, unknown> & { sign?: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; value: Record<string, unknown> }; post?: { endpoint: string; body: Record<string, unknown> } } }[];
}
interface RelayQuote {
  steps: RelayStep[];
  details: { currencyOut: { amountFormatted: string }; timeEstimate: number };
}

async function relayQuote(body: Record<string, unknown>): Promise<RelayQuote> {
  const res = await fetch(`${RELAY}/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as RelayQuote & { message?: string };
  if (!res.ok || !json.steps) throw new Error(json.message ?? 'No route right now — try again in a moment.');
  return json;
}

/** What a deposit of `amountUsd` from `source` lands as on Hyperliquid. */
export async function quoteDeposit(user: string, source: (typeof PERPS_SOURCES)[number], amountUsd: number): Promise<RelayQuote> {
  return relayQuote({
    user,
    recipient: user,
    originChainId: source.chainId,
    destinationChainId: HL_CHAIN,
    originCurrency: source.usdc,
    destinationCurrency: HL_PERPS_USDC,
    amount: BigInt(Math.floor(amountUsd * 100)) * 10n ** BigInt(source.decimals - 2) + '',
    tradeType: 'EXACT_INPUT',
  });
}

/** Run a deposit quote: approve + send on the source chain. */
export async function runDeposit(quote: RelayQuote): Promise<void> {
  for (const step of quote.steps) {
    if (step.kind !== 'transaction') continue;
    for (const item of step.items) {
      const tx = item.data as { to: `0x${string}`; data: `0x${string}`; value?: string; chainId: number };
      const chainId = tx.chainId as 8453 | 56;
      if (getAccount(wagmiConfig).chainId !== chainId) await switchChain(wagmiConfig, { chainId });
      const hash = await sendTransaction(wagmiConfig, { to: tx.to, data: tx.data, value: BigInt(tx.value ?? '0'), chainId });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId, timeout: 90_000 });
    }
  }
}

/** Withdraw `amountUsd` of perps USDC to Kamby's Base balance. */
export async function quoteWithdraw(user: string, amountUsd: number): Promise<RelayQuote> {
  return relayQuote({
    user,
    recipient: user,
    refundTo: user,
    originChainId: HL_CHAIN,
    destinationChainId: 8453,
    originCurrency: HL_PERPS_USDC,
    destinationCurrency: PERPS_SOURCES[0]!.usdc,
    amount: String(Math.floor(amountUsd * 1e8)), // perps USDC has 8 decimals
    tradeType: 'EXACT_INPUT',
    protocolVersion: 'v2',
  });
}

/** Run a withdrawal: authorize the nonce with Relay, then sign the Hyperliquid transfer. */
export async function runWithdraw(quote: RelayQuote): Promise<void> {
  const wallet = await masterWallet();
  const chainId = await wallet.getChainId();
  for (const step of quote.steps) {
    const item = step.items[0];
    if (!item) continue;
    if (step.kind === 'signature' && item.data.sign && item.data.post) {
      const { sign, post } = item.data;
      const signature = await wallet.signTypedData({
        account: wallet.account!,
        domain: { ...sign.domain, chainId } as never,
        types: sign.types,
        primaryType: sign.primaryType,
        message: sign.value,
      });
      const res = await fetch(`${RELAY}${post.endpoint}?signature=${signature}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post.body, signatureChainId: chainId }),
      });
      if (!res.ok) throw new Error('Relay could not authorize the withdrawal — try again.');
    } else if (step.kind === 'transaction') {
      const data = item.data as { action: { type: string; parameters: Record<string, unknown> }; nonce: number; eip712Types: Record<string, { name: string; type: string }[]>; eip712PrimaryType: string };
      const value = { ...data.action.parameters, type: data.action.type, signatureChainId: `0x${chainId.toString(16)}` };
      const signature = await wallet.signTypedData({
        account: wallet.account!,
        domain: { name: 'HyperliquidSignTransaction', version: '1', chainId, verifyingContract: '0x0000000000000000000000000000000000000000' },
        types: data.eip712Types,
        primaryType: data.eip712PrimaryType,
        message: value,
      });
      const { r, s, v } = parseSignature(signature);
      const res = await fetch('https://api.hyperliquid.xyz/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: value, nonce: data.action.parameters.nonce ?? data.nonce, signature: { r, s, v: Number(v ?? 0n) } }),
      });
      const json = (await res.json().catch(() => null)) as { status?: string; response?: unknown } | null;
      if (json?.status !== 'ok') throw new Error(typeof json?.response === 'string' ? json.response : 'Hyperliquid refused the transfer — try again.');
    }
  }
}
