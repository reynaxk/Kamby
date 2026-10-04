import { Inject, Injectable } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { XXXRISK_FILTER, type XxxRiskFlag, type XxxRiskToken } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';
import { CryptoPriceService } from './crypto-price.service';

const LAMPORTS = 1e9;
const PUMP_DECIMALS = 1e6;
const REDIS_KEY = 'feeds:xxxrisk';
const REDIS_TTL_SECONDS = 10;

interface CurveRow {
  mintAddress: string;
  symbol: string | null;
  name: string | null;
  createdAt: Date;
  virtualSolReserves: string;
  virtualTokenReserves: string;
  realSolReserves: string;
  tokenTotalSupply: string;
}

/** Exported for tests. USD liquidity (SOL in the curve) and market cap from curve reserves. */
export function curveValuesUsd(row: CurveRow, solUsd: number): { liquidityUsd: number; marketCapUsd: number } {
  const vSol = Number(row.virtualSolReserves) / LAMPORTS;
  const vTok = Number(row.virtualTokenReserves) / PUMP_DECIMALS;
  const supply = Number(row.tokenTotalSupply) / PUMP_DECIMALS;
  const priceSol = vTok > 0 ? vSol / vTok : 0;
  return { liquidityUsd: (Number(row.realSolReserves) / LAMPORTS) * solUsd, marketCapUsd: priceSol * supply * solUsd };
}

interface JupiterStats {
  id: string;
  icon?: string;
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; devBalancePercentage?: number; topHoldersPercentage?: number };
  stats5m?: { buyVolume?: number; sellVolume?: number; numTraders?: number };
}

/** Exported for tests. Rug-risk flags from Jupiter's audit; a coin it hasn't audited yet says so. */
export function riskFlags(j: JupiterStats | undefined): XxxRiskFlag[] {
  if (!j?.audit) return ['unverified-audit'];
  const flags: XxxRiskFlag[] = [];
  if (j.audit.mintAuthorityDisabled === false) flags.push('mintable');
  if (j.audit.freezeAuthorityDisabled === false) flags.push('freezable');
  if ((j.audit.devBalancePercentage ?? 0) > 20) flags.push('dev-holds-over-20pct');
  if ((j.audit.topHoldersPercentage ?? 0) > 50) flags.push('top-holders-over-50pct');
  return flags;
}

/**
 * The "XXXRisk" feed (user spec 2026-10-03), built from data Kamby already has: Pump.fun curves
 * under 5 minutes old (launch events from PumpPortal, reserves kept current on-chain by the
 * workers' curve refresher) priced with the live SOL price, filtered to $1–3K liquidity and
 * $5–15K market cap, then enriched with ONE Jupiter call per cycle (5-minute volume, traders,
 * audit, picture) and sorted by volume. Rebuilt with the other feeds every ~10s, cached in
 * Redis for 10s, streamed over the existing SSE feed — never fetched by browsers directly.
 */
@Injectable()
export class XxxRiskService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly cryptoPrices: CryptoPriceService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('XxxRiskService');
  }

  async build(): Promise<XxxRiskToken[]> {
    const solUsd = this.cryptoPrices.snapshot().find((p) => p.symbol === 'SOL')?.priceUsd;
    if (!solUsd) return [];
    const now = Date.now();
    const rows = await prisma.pumpFunToken.findMany({
      where: { complete: false, createdAt: { gte: new Date(now - XXXRISK_FILTER.maxAgeSeconds * 1000) } },
      orderBy: { createdAt: 'desc' },
      take: 400,
      select: { mintAddress: true, symbol: true, name: true, createdAt: true, virtualSolReserves: true, virtualTokenReserves: true, realSolReserves: true, tokenTotalSupply: true },
    });
    const candidates = rows
      .map((row) => ({ row, ...curveValuesUsd(row, solUsd) }))
      .filter(
        (c) =>
          c.liquidityUsd >= XXXRISK_FILTER.minLiquidityUsd &&
          c.liquidityUsd <= XXXRISK_FILTER.maxLiquidityUsd &&
          c.marketCapUsd >= XXXRISK_FILTER.minMarketCapUsd &&
          c.marketCapUsd <= XXXRISK_FILTER.maxMarketCapUsd,
      )
      .slice(0, 100);
    const stats = await this.jupiterStats(candidates.map((c) => c.row.mintAddress));

    const tokens: XxxRiskToken[] = candidates.map(({ row, liquidityUsd, marketCapUsd }) => {
      const j = stats.get(row.mintAddress);
      const volume = j?.stats5m ? (j.stats5m.buyVolume ?? 0) + (j.stats5m.sellVolume ?? 0) : null;
      return {
        mintAddress: row.mintAddress,
        symbol: row.symbol,
        name: row.name,
        imageUrl: j?.icon?.startsWith('https://') ? j.icon : null,
        ageSeconds: Math.max(0, Math.round((now - row.createdAt.getTime()) / 1000)),
        liquidityUsd,
        marketCapUsd,
        volume5mUsd: volume,
        traders5m: j?.stats5m?.numTraders ?? null,
        riskFlags: riskFlags(j),
      };
    });
    tokens.sort((a, b) => (b.volume5mUsd ?? 0) - (a.volume5mUsd ?? 0));
    const top = tokens.slice(0, XXXRISK_FILTER.limit);
    await this.redis.set(REDIS_KEY, JSON.stringify(top), 'EX', REDIS_TTL_SECONDS).catch(() => undefined);
    return top;
  }

  /** The last list the stream built (≤10s old) — for page snapshots, never a fresh Jupiter call. */
  async cached(): Promise<XxxRiskToken[]> {
    try {
      const hit = await this.redis.get(REDIS_KEY);
      return hit ? (JSON.parse(hit) as XxxRiskToken[]) : [];
    } catch {
      return [];
    }
  }

  /** The single outbound call per cycle — Jupiter's free token search, up to 100 mints. */
  private async jupiterStats(mints: string[]): Promise<Map<string, JupiterStats>> {
    const out = new Map<string, JupiterStats>();
    if (mints.length === 0) return out;
    try {
      const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.join(',')}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return out;
      const body = (await res.json()) as JupiterStats[];
      for (const t of Array.isArray(body) ? body : []) if (t.id) out.set(t.id, t);
    } catch (error) {
      this.logger.warn({ err: error }, 'XXXRisk: Jupiter stats unavailable this cycle');
    }
    return out;
  }
}
