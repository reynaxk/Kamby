import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { emptyTokenInfo, type TokenInfo, type TokenInfoChain } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';
import { isListedCoin } from './listed-coins';

const GECKO_NETWORK: Record<TokenInfoChain, string> = { base: 'base', bnb: 'bsc', solana: 'solana' };
const DEXSCREENER_CHAIN: Record<TokenInfoChain, string> = { base: 'base', bnb: 'bsc', solana: 'solana' };
/** Project links barely change — a day is fresh enough, and keeps GeckoTerminal's ~30/min
 *  shared budget for charts. A failed lookup is retried after 10 minutes. */
const INFO_TTL_SECONDS = 24 * 60 * 60;
const FAILED_TTL_SECONDS = 10 * 60;
const MAX_WEBSITES = 3;
const MAX_DESCRIPTION_CHARS = 600;

const TWITTER_HOSTS = new Set(['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'mobile.twitter.com']);
const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'www.t.me']);
const DISCORD_HOSTS = new Set(['discord.gg', 'discord.com', 'www.discord.com', 'discordapp.com']);

/** Exported for tests. Only a well-formed https URL (optionally on one of `hosts`) survives —
 *  these links are project-submitted, so nothing else (javascript:, http:, look-alike hosts)
 *  is ever rendered as a link. */
export function safeUrl(raw: unknown, hosts?: Set<string>): string | null {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (hosts && !hosts.has(url.hostname.toLowerCase())) return null;
  return url.toString();
}

/** Exported for tests. */
export function twitterUrlFromHandle(handle: unknown): string | null {
  if (typeof handle !== 'string') return null;
  const clean = handle.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(clean) ? `https://x.com/${clean}` : null;
}

/** Exported for tests. */
export function telegramUrlFromHandle(handle: unknown): string | null {
  if (typeof handle !== 'string') return null;
  const clean = handle.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{4,32}$/.test(clean) ? `https://t.me/${clean}` : null;
}

function cleanDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > MAX_DESCRIPTION_CHARS ? `${text.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…` : text;
}

interface GeckoInfoAttributes {
  websites?: unknown;
  twitter_handle?: unknown;
  telegram_handle?: unknown;
  discord_url?: unknown;
  description?: unknown;
}

/** Exported for tests. */
export function fromGeckoTerminal(attributes: GeckoInfoAttributes | undefined): TokenInfo {
  const info = emptyTokenInfo();
  if (!attributes) return info;
  info.websites = (Array.isArray(attributes.websites) ? attributes.websites : [])
    .map((w) => safeUrl(w))
    .filter((w): w is string => w !== null)
    .slice(0, MAX_WEBSITES);
  info.twitterUrl = twitterUrlFromHandle(attributes.twitter_handle);
  info.telegramUrl = telegramUrlFromHandle(attributes.telegram_handle);
  info.discordUrl = safeUrl(attributes.discord_url, DISCORD_HOSTS);
  info.description = cleanDescription(attributes.description);
  info.source = 'geckoterminal';
  return info;
}

interface DexScreenerPair {
  info?: { websites?: { url?: unknown }[]; socials?: { type?: unknown; url?: unknown }[] };
}

/** Exported for tests. */
export function fromDexScreener(pairs: DexScreenerPair[] | null | undefined): TokenInfo {
  const info = emptyTokenInfo();
  const withInfo = (pairs ?? []).find((p) => p.info && (p.info.websites?.length || p.info.socials?.length));
  if (!withInfo?.info) return info;
  info.websites = (withInfo.info.websites ?? [])
    .map((w) => safeUrl(w.url))
    .filter((w): w is string => w !== null)
    .slice(0, MAX_WEBSITES);
  for (const social of withInfo.info.socials ?? []) {
    if (social.type === 'twitter') info.twitterUrl ??= safeUrl(social.url, TWITTER_HOSTS);
    if (social.type === 'telegram') info.telegramUrl ??= safeUrl(social.url, TELEGRAM_HOSTS);
    if (social.type === 'discord') info.discordUrl ??= safeUrl(social.url, DISCORD_HOSTS);
  }
  info.source = 'dexscreener';
  return info;
}

function hasLinks(info: TokenInfo): boolean {
  return info.websites.length > 0 || info.twitterUrl !== null || info.telegramUrl !== null || info.discordUrl !== null;
}

/**
 * Website / X / Telegram / Discord and a short description for a coin's "About" card
 * (user request 2026-09-30). GeckoTerminal's free token-info API first — the same vendor as
 * the Solana charts — then DexScreener's free token API when GeckoTerminal has no links.
 * Cached a day in Redis and shared by every viewer, and only for coins Kamby lists, so
 * arbitrary addresses can't spend the shared GeckoTerminal budget.
 */
@Injectable()
export class TokenInfoService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('TokenInfoService');
  }

  async info(chain: TokenInfoChain, address: string): Promise<TokenInfo> {
    const canonical = chain === 'solana' ? address : address.toLowerCase();
    const key = `token-info:${chain}:${canonical}`;
    try {
      const hit = await this.redis.get(key);
      if (hit !== null) return JSON.parse(hit) as TokenInfo;
    } catch {
      // Redis down — look it up fresh.
    }
    if (!(await isListedCoin(chain, address))) throw new NotFoundException('Kamby does not list this coin');

    const { info, failed } = await this.lookup(chain, address);
    try {
      await this.redis.set(key, JSON.stringify(info), 'EX', failed ? FAILED_TTL_SECONDS : INFO_TTL_SECONDS);
    } catch {
      // Served uncached.
    }
    return info;
  }

  private async lookup(chain: TokenInfoChain, address: string): Promise<{ info: TokenInfo; failed: boolean }> {
    const gecko = await this.fetchJson<{ data?: { attributes?: GeckoInfoAttributes } }>(
      `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK[chain]}/tokens/${address}/info`,
    );
    const fromGecko = fromGeckoTerminal(gecko?.data?.attributes);
    if (hasLinks(fromGecko)) return { info: fromGecko, failed: false };

    const dex = await this.fetchJson<DexScreenerPair[]>(`https://api.dexscreener.com/tokens/v1/${DEXSCREENER_CHAIN[chain]}/${address}`);
    const fromDex = fromDexScreener(Array.isArray(dex) ? dex : null);
    if (hasLinks(fromDex)) return { info: { ...fromDex, description: fromDex.description ?? fromGecko.description }, failed: false };

    // No links anywhere: keep GeckoTerminal's description if it had one. Only a lookup where
    // both sources were unreachable counts as failed (and is retried sooner).
    return { info: gecko ? fromGecko : emptyTokenInfo(), failed: gecko === null && dex === null };
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        this.logger.warn({ status: response.status, host: new URL(url).host }, 'Token info request failed');
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn({ err: error, host: new URL(url).host }, 'Token info source unreachable');
      return null;
    }
  }
}
