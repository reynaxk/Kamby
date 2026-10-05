import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { TokenHolder, TokenHolders, TokenInfoChain } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { PublicKey } from '@solana/web3.js';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SOLANA_CONNECTION_POOL, type SolanaConnectionPool } from '../chain/solana-connection-pool';
import { isListedCoin } from './listed-coins';

const GOPLUS_EVM_CHAIN_ID: Record<Exclude<TokenInfoChain, 'solana'>, number> = { base: 8453, bnb: 56 };
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

/** Exported for tests. A Solana "holder" whose address is off the ed25519 curve is a program
 *  account — a launchpad bonding curve, an AMM pool, a vault — not a person: labelled as such,
 *  so it never gets a whale badge (2026-10-05: a bonding curve showed as the 36% top holder). */
export function markSolanaPrograms(holders: TokenHolders): TokenHolders {
  return {
    ...holders,
    holders: holders.holders.map((h) => {
      try {
        return PublicKey.isOnCurve(new PublicKey(h.address).toBytes()) ? h : { ...h, isContract: true, tag: h.tag ?? 'Pool / curve' };
      } catch {
        return h;
      }
    }),
  };
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
    @Inject(SOLANA_CONNECTION_POOL) private readonly solanaPool: SolanaConnectionPool | null,
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
    const result = fromGoPlus(token) ?? (chain === 'solana' ? await this.solanaLargestAccounts(address) : null);
    return result && chain === 'solana' ? markSolanaPrograms(result) : result;
  }

  /**
   * A Solana coin too new for GoPlus: its 20 largest token accounts straight from the chain,
   * through the API's Solana pool (Helius, falling back to the public node). Found 2026-10-04:
   * the public node alone answers this call with "429 Too many requests for a specific RPC
   * call" nearly every time, so new coins showed no holders. Cached like every other answer.
   */
  private async solanaLargestAccounts(mint: string): Promise<TokenHolders | null> {
    if (!this.solanaPool) return null;
    try {
      const mintKey = new PublicKey(mint);
      const [largest, supply] = await this.solanaPool.withFailover((c) => Promise.all([c.getTokenLargestAccounts(mintKey), c.getTokenSupply(mintKey)]));
      const accounts = largest.value.filter((a) => (a.uiAmount ?? 0) > 0).slice(0, MAX_HOLDERS);
      const total = supply.value.uiAmount ?? 0;
      if (accounts.length === 0 || total <= 0) return null;
      // Token accounts → their owner wallets (one call for all of them).
      const parsed = await this.solanaPool.withFailover((c) => c.getMultipleParsedAccounts(accounts.map((a) => a.address)));
      const holders = accounts.map((a, i): TokenHolder => {
        const data = parsed.value[i]?.data;
        const owner = data && 'parsed' in data ? (data.parsed as { info?: { owner?: string } }).info?.owner : undefined;
        return { address: owner ?? a.address.toBase58(), balance: a.uiAmount ?? 0, percent: ((a.uiAmount ?? 0) / total) * 100, isContract: false, tag: null };
      });
      return { holderCount: null, holders, atIso: new Date().toISOString() };
    } catch (error) {
      this.logger.warn({ err: error }, 'Solana largest-accounts lookup failed');
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
