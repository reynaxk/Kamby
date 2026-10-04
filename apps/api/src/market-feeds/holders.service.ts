import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { TokenHolder, TokenHolders, TokenInfoChain } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';
import { isListedCoin } from './listed-coins';

const GOPLUS_EVM_CHAIN_ID: Record<Exclude<TokenInfoChain, 'solana'>, number> = { base: 8453, bnb: 56 };
/** Solana's free public RPC — market data stays off the paid QuickNode plan (trades only). */
const SOLANA_PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';
const HOLDERS_TTL_SECONDS = 60;
const FAILED_TTL_SECONDS = 15;
const MAX_HOLDERS = 20;
const FETCH_TIMEOUT_MS = 8_000;

interface GoPlusHolder {
  address?: string;
  /** Solana: the owner wallet (`address` is absent there). */
  account?: string;
  balance?: string;
  /** A fraction of supply, 0–1. */
  percent?: string;
  is_contract?: number;
  tag?: string;
}

interface GoPlusToken {
  holder_count?: string;
  holders?: GoPlusHolder[];
}

/** Exported for tests. GoPlus's holder rows into Kamby's, largest first; malformed rows dropped. */
export function fromGoPlus(token: GoPlusToken | undefined): TokenHolders | null {
  const rows = (token?.holders ?? [])
    .map((h): TokenHolder | null => {
      const address = h.address ?? h.account;
      const balance = Number(h.balance);
      const fraction = Number(h.percent);
      if (!address || !Number.isFinite(balance) || !Number.isFinite(fraction)) return null;
      return { address, balance, percent: fraction * 100, isContract: h.is_contract === 1, tag: h.tag?.trim() || null };
    })
    .filter((h): h is TokenHolder => h !== null)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, MAX_HOLDERS);
  if (rows.length === 0) return null;
  const count = Number(token?.holder_count);
  return { holderCount: Number.isFinite(count) && count > 0 ? count : null, holders: rows, atIso: new Date().toISOString() };
}

/**
 * A coin's largest holders for the terminal's Holders tab (user request 2026-10-04 — the tab
 * was an empty "soon" placeholder). GoPlus's free token-security API (already used for
 * listing safety) returns the top holders and total holder count on Base, BNB and Solana;
 * a Solana coin too new for GoPlus falls back to the chain itself (largest token accounts).
 * Cached a minute in Redis and shared by every viewer, and only served for coins Kamby
 * lists, so arbitrary addresses can't spend the free GoPlus budget. USD values and the
 * whale/shark/fish labels are worked out in the browser from the live price.
 */
@Injectable()
export class HoldersService {
  private readonly inFlight = new Map<string, Promise<TokenHolders>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('HoldersService');
  }

  async holders(chain: TokenInfoChain, address: string): Promise<TokenHolders> {
    const canonical = chain === 'solana' ? address : address.toLowerCase();
    const key = `holders:${chain}:${canonical}`;
    try {
      const hit = await this.redis.get(key);
      if (hit !== null) return JSON.parse(hit) as TokenHolders;
    } catch {
      // Redis down — look it up fresh.
    }
    if (!(await isListedCoin(chain, address))) throw new NotFoundException('Kamby does not list this coin');

    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const lookup = this.lookup(chain, address)
      .then(async (result) => {
        const value = result ?? { holderCount: null, holders: [], atIso: new Date().toISOString() };
        try {
          await this.redis.set(key, JSON.stringify(value), 'EX', result ? HOLDERS_TTL_SECONDS : FAILED_TTL_SECONDS);
        } catch {
          // Served uncached.
        }
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, lookup);
    return lookup;
  }

  private async lookup(chain: TokenInfoChain, address: string): Promise<TokenHolders | null> {
    const url =
      chain === 'solana'
        ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`
        : `https://api.gopluslabs.io/api/v1/token_security/${GOPLUS_EVM_CHAIN_ID[chain]}?contract_addresses=${address}`;
    const body = await this.fetchJson<{ result?: Record<string, GoPlusToken> }>(url);
    const token = body?.result ? (body.result[address] ?? body.result[address.toLowerCase()] ?? Object.values(body.result)[0]) : undefined;
    const fromSource = fromGoPlus(token);
    if (fromSource) return fromSource;
    return chain === 'solana' ? this.solanaLargestAccounts(address) : null;
  }

  /** A brand-new Solana coin: its 20 largest token accounts straight from the chain. */
  private async solanaLargestAccounts(mint: string): Promise<TokenHolders | null> {
    const [largest, supply] = await Promise.all([
      this.rpc<{ value?: { address: string; uiAmount: number | null }[] }>('getTokenLargestAccounts', [mint]),
      this.rpc<{ value?: { uiAmount: number | null } }>('getTokenSupply', [mint]),
    ]);
    const accounts = (largest?.value ?? []).filter((a) => (a.uiAmount ?? 0) > 0).slice(0, MAX_HOLDERS);
    const total = supply?.value?.uiAmount ?? 0;
    if (accounts.length === 0 || total <= 0) return null;
    // Token accounts → their owner wallets (one call for all of them).
    const parsed = await this.rpc<{ value?: ({ data?: { parsed?: { info?: { owner?: string } } } } | null)[] }>('getMultipleAccounts', [
      accounts.map((a) => a.address),
      { encoding: 'jsonParsed' },
    ]);
    const holders = accounts.map((a, i): TokenHolder => {
      const owner = parsed?.value?.[i]?.data?.parsed?.info?.owner;
      return { address: owner ?? a.address, balance: a.uiAmount ?? 0, percent: ((a.uiAmount ?? 0) / total) * 100, isContract: false, tag: null };
    });
    return { holderCount: null, holders, atIso: new Date().toISOString() };
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T | null> {
    try {
      const res = await fetch(SOLANA_PUBLIC_RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn({ status: res.status, method }, 'Solana public RPC request failed');
        return null;
      }
      const body = (await res.json()) as { result?: T };
      return body.result ?? null;
    } catch (error) {
      this.logger.warn({ err: error, method }, 'Solana public RPC unreachable');
      return null;
    }
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        this.logger.warn({ status: res.status }, 'GoPlus holders request failed');
        return null;
      }
      return (await res.json()) as T;
    } catch (error) {
      this.logger.warn({ err: error }, 'GoPlus unreachable');
      return null;
    }
  }
}
