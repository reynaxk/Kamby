import { prisma } from '@kamby/db';
import { SOLANA_USDC_MINT } from '@kamby/domain';
import type { Logger } from 'pino';
import { SOLANA_SEED_MARKETS } from './solana-seed-markets';

/** Jupiter's free Tokens API v2 (the keyless lite host; verified 2026-10-03). */
const JUPITER_TOKENS = 'https://lite-api.jup.ag/tokens/v2';
/** Lists that feed discovery each tick — trending/traded/organic over two windows. */
const LISTS = ['toptrending/1h', 'toptraded/1h', 'toporganicscore/1h', 'toptrending/24h', 'toptraded/24h'];
/** Discovered coins not seen in any list (and not refreshable) for this long are removed. */
const DISCOVERED_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_BATCH = 100;

export interface JupiterToken {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  usdPrice?: number;
  mcap?: number;
  liquidity?: number;
  holderCount?: number;
  launchpad?: string | null;
  organicScoreLabel?: 'low' | 'medium' | 'high';
  isVerified?: boolean;
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; devBalancePercentage?: number; topHoldersPercentage?: number };
  stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number };
}

/** The safety bar a Jupiter-listed coin must clear before Kamby shows it. */
export const DISCOVERY_SAFETY = {
  minLiquidityUsd: 10_000,
  minHolders: 50,
  maxDevBalancePct: 20,
} as const;

/**
 * Exported for tests. Whether a coin from Jupiter's lists is safe enough to list: real trading
 * (organic score not "low"), no mint or freeze authority (no surprise minting or frozen
 * wallets), real liquidity and holders, and the developer not holding a big share.
 */
export function passesSafety(t: JupiterToken): boolean {
  if (!t.id || !t.symbol || !t.usdPrice || t.usdPrice <= 0) return false;
  if (t.organicScoreLabel === 'low') return false;
  if (t.audit?.mintAuthorityDisabled === false || t.audit?.freezeAuthorityDisabled === false) return false;
  if ((t.liquidity ?? 0) < DISCOVERY_SAFETY.minLiquidityUsd) return false;
  if ((t.holderCount ?? 0) < DISCOVERY_SAFETY.minHolders) return false;
  if ((t.audit?.devBalancePercentage ?? 0) > DISCOVERY_SAFETY.maxDevBalancePct) return false;
  return true;
}

/**
 * Solana coins from every launchpad (pump.fun, letsbonk.fun, Meteora DBC, Raydium LaunchLab,
 * …) via Jupiter's token lists — user request 2026-10-03: "a lot of coins choices". Each tick
 * pulls Jupiter's trending/top-traded/top-organic lists, keeps coins that pass
 * `passesSafety`, and upserts them as SolanaTokenMarket rows (the launchpad goes in `dex`), so
 * they show up in Trending, search and the Solana trade page with no other change. Coins
 * already listed are re-priced in batches; ones gone for 6 hours are removed. The curated
 * seed markets are never touched (SolanaMarketIngestionService owns them). Every listed coin
 * is tradable: Jupiter routes it, bonding curves included.
 */
export class JupiterSolanaDiscoveryService {
  constructor(private readonly logger: Logger) {}

  async run(): Promise<{ listed: number; refreshed: number; removed: number; rejected: number }> {
    const seeds = new Set(SOLANA_SEED_MARKETS.map((s) => s.mintAddress));
    const found = new Map<string, JupiterToken>();
    let rejected = 0;
    for (const list of LISTS) {
      for (const t of await this.fetchList(`${JUPITER_TOKENS}/${list}?limit=100`)) {
        if (seeds.has(t.id) || found.has(t.id)) continue;
        if (passesSafety(t)) found.set(t.id, t);
        else rejected += 1;
      }
    }

    // Re-price coins listed earlier that dropped off this tick's lists.
    const existing = await prisma.solanaTokenMarket.findMany({ where: { mintAddress: { notIn: [...seeds] } }, select: { mintAddress: true } });
    const stale = existing.map((e) => e.mintAddress).filter((m) => !found.has(m));
    let refreshed = 0;
    for (let i = 0; i < stale.length; i += SEARCH_BATCH) {
      for (const t of await this.fetchList(`${JUPITER_TOKENS}/search?query=${stale.slice(i, i + SEARCH_BATCH).join(',')}`)) {
        if (passesSafety(t)) {
          found.set(t.id, t);
          refreshed += 1;
        }
      }
    }

    const now = new Date();
    for (const t of found.values()) {
      const data = {
        symbol: t.symbol ?? null,
        name: t.name ?? null,
        decimals: t.decimals ?? null,
        logoUrl: t.icon ?? null,
        quoteMintAddress: SOLANA_USDC_MINT,
        quoteSymbol: 'USDC',
        dex: t.launchpad ?? 'solana',
        priceUsd: t.usdPrice!,
        liquidityUsd: t.liquidity ?? null,
        volume24hUsd: (t.stats24h?.buyVolume ?? 0) + (t.stats24h?.sellVolume ?? 0),
        priceChange24hPct: t.stats24h?.priceChange ?? null,
        marketCapUsd: t.mcap ?? null,
        lastPriceUpdateAt: now,
      };
      try {
        await prisma.solanaTokenMarket.upsert({ where: { mintAddress: t.id }, update: data, create: { mintAddress: t.id, ...data } });
      } catch (error) {
        this.logger.warn({ err: error, mint: t.id }, 'Jupiter discovery: could not store one coin');
      }
    }

    const { count: removed } = await prisma.solanaTokenMarket.deleteMany({
      where: { mintAddress: { notIn: [...seeds] }, OR: [{ lastPriceUpdateAt: null }, { lastPriceUpdateAt: { lt: new Date(Date.now() - DISCOVERED_TTL_MS) } }] },
    });
    return { listed: found.size, refreshed, removed, rejected };
  }

  private async fetchList(url: string): Promise<JupiterToken[]> {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        this.logger.warn({ status: response.status, url: url.split('?')[0] }, 'Jupiter discovery request failed');
        return [];
      }
      const body = (await response.json()) as unknown;
      return Array.isArray(body) ? (body as JupiterToken[]) : [];
    } catch (error) {
      this.logger.warn({ err: error, url: url.split('?')[0] }, 'Jupiter discovery unreachable');
      return [];
    }
  }
}
