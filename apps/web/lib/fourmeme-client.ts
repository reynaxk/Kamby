'use client';

import type { LaunchEvmTx } from '@kamby/domain';
import { signMessage } from 'wagmi/actions';
import { API_BASE, authedFetch } from './session-client';
import { wagmiConfig } from './wagmi-config';

/** Four.meme's API, through kambesh.com (it refuses Kamby's servers; see app/api/fourmeme). */
async function fourMeme<T>(op: string, init: RequestInit): Promise<T> {
  const res = await fetch(`/api/fourmeme/${op}`, { method: 'POST', ...init });
  const json = (await res.json().catch(() => null)) as { code?: string | number; data?: T; msg?: string; message?: string } | null;
  if (!res.ok || !json || String(json.code) !== '0') throw new Error(json?.msg || json?.message || "Four.meme didn't accept that — try again.");
  return json.data as T;
}

/** The creator signs in to Four.meme with their own wallet (a free signature, no transaction). */
async function login(address: string): Promise<string> {
  const nonce = await fourMeme<string>('nonce', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountAddress: address, verifyType: 'LOGIN', networkCode: 'BSC' }),
  });
  const signature = await signMessage(wagmiConfig, { message: `You are sign in Meme ${nonce}` });
  return fourMeme<string>('login', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ region: 'WEB', langType: 'EN', loginIp: '', inviteCode: '', verifyInfo: { address, networkCode: 'BSC', signature, verifyType: 'LOGIN' }, walletName: 'MetaMask' }),
  });
}

export interface FourMemeLaunchInput {
  address: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  /** The first buy, in BNB (from Kamby's create-params). */
  preSale: string;
}

/**
 * Four.meme's side of a launch: sign in, upload the logo (Four.meme only takes its own uploads),
 * and get the signed create payload — Kamby's API turns it into the on-chain create.
 */
export async function fourMemeCreatePayload(input: FourMemeLaunchInput): Promise<{ createArg: string; signature: string; preSale: string }> {
  const access = await login(input.address);
  const logo = await fetch(input.imageUrl).then((r) => r.blob());
  const form = new FormData();
  form.append('file', new File([logo], 'logo', { type: logo.type || 'image/png' }));
  const imgUrl = await fourMeme<string>('upload', { headers: { 'meme-web-access': access }, body: form });
  const raisedToken = await fetch('/api/fourmeme/config', { method: 'POST' })
    .then((r) => r.json() as Promise<{ data?: { symbol: string; status: string; networkCode: string }[] }>)
    .then((j) => (j.data ?? []).find((t) => t.symbol === 'BNB' && t.status === 'PUBLISH' && t.networkCode === 'BSC'));
  if (!raisedToken) throw new Error("Couldn't read Four.meme's launch settings — try again.");
  const created = await fourMeme<{ createArg: string; signature: string }>('create', {
    headers: { 'meme-web-access': access, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      shortName: input.symbol,
      desc: input.description || input.name,
      imgUrl,
      launchTime: Date.now(),
      label: 'Meme',
      lpTradingFee: 0.0025,
      webUrl: input.website ?? '',
      twitterUrl: input.twitter ?? '',
      telegramUrl: input.telegram ?? '',
      preSale: input.preSale,
      feePlan: false,
      raisedToken,
    }),
  });
  return { createArg: created.createArg, signature: created.signature, preSale: input.preSale };
}

// --- Trading a coin still on its curve -------------------------------------------------------

export interface CurveState {
  graduated: boolean;
  priceUsd: number | null;
  marketCapUsd: number | null;
  progressPct: number;
}

export interface CurveStep {
  id: string;
  transactions: LaunchEvmTx[] | null;
  estimateRaw?: string;
  done?: { tokensRaw?: string; usdcRaw?: string };
}

async function ok<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Something went wrong (${res.status})`;
    try {
      const json = (await res.json()) as { message?: string | string[] };
      if (json.message) message = Array.isArray(json.message) ? json.message[0]! : json.message;
    } catch {
      // keep the fallback
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const fetchCurveState = (token: string) => fetch(`${API_BASE}/v1/trading/fourmeme/${token}/state`).then((r) => ok<CurveState>(r));
export const startCurveTrade = async (body: { side: 'BUY' | 'SELL'; walletAddress: string; token: string; amountUsd?: number; amountRaw?: string }) =>
  ok<CurveStep>(await authedFetch('/trading/fourmeme/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
export const nextCurveStep = async (id: string, txHashes: string[]) =>
  ok<CurveStep>(await authedFetch(`/trading/fourmeme/trades/${id}/next`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHashes }) }));
