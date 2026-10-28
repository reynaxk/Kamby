import { Inject, Injectable } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { pumpFunGraduationProgressPct, XXXRISK_FILTER, type XxxRiskColumn, type XxxRiskFlag, type XxxRiskToken } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';
import { CryptoPriceService } from './crypto-price.service';

const LAMPORTS = 1e9;
const PUMP_DECIMALS = 1e6;
const REDIS_KEY = 'feeds:xxxrisk';
const REDIS_TTL_SECONDS = 10;
const GEMS_URL = 'https://datapi.jup.ag/v1/pools/gems';
/** Per column, after merging — GMGN-style lists that scroll. */
const PER_COLUMN = 60;

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
  holderCount?: number;
  twitter?: string;
  telegram?: string;
  website?: string;
  audit?: {
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    devBalancePercentage?: number;
    topHoldersPercentage?: number;
    sniperPct?: number;
    insiderPct?: number;
    bundlerStats?: { holdingPct?: number };
  };
  stats5m?: { buyVolume?: number; sellVolume?: number; numTraders?: number; numBuys?: number; numSells?: number; priceChange?: number };
}

/** One pool from Jupiter's launchpad board (the data behind jup.ag's Pulse). */
interface GemsPool {
  liquidity?: number;
  /** 0-100 toward leaving the curve. */
  bondingCurve?: number;
  createdAt?: string;
  baseAsset?: JupiterStats & {
    name?: string;
    symbol?: string;
    launchpad?: string;
    mcap?: number;
    createdAt?: string;
    graduatedAt?: string;
  };
}
type GemsBody = Partial<Record<'recent' | 'aboutToGraduate' | 'graduated', { pools?: GemsPool[] }>>;

const ms = (iso: string | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

const httpsOnly = (url: string | undefined) => (url?.startsWith('https://') ? url : undefined);

/** Exported for tests. A coin's socials from Jupiter — https links only, empty ones dropped. */
export function socialsOf(j: JupiterStats | undefined): XxxRiskToken['socials'] {
  const out: NonNullable<XxxRiskToken['socials']> = {};
  const twitter = httpsOnly(j?.twitter);
  const telegram = httpsOnly(j?.telegram);
  const website = httpsOnly(j?.website);
  if (twitter) out.twitter = twitter;
  if (telegram) out.telegram = telegram;
  if (website) out.website = website;
  return out;
}

const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/** Exported for tests. A launchpad-board pool as a card; null when it lacks a price. */
export function gemsToken(pool: GemsPool, column: XxxRiskColumn, now: number): XxxRiskToken | null {
  const a = pool.baseAsset;
  const marketCapUsd = num(a?.mcap);
  if (!a?.id || marketCapUsd === null || marketCapUsd <= 0) return null;
  const createdAtMs = ms(a.createdAt) ?? ms(pool.createdAt) ?? now;
  const s5 = a.stats5m;
  return {
    mintAddress: a.id,
    symbol: a.symbol ?? null,
    name: a.name ?? null,
    imageUrl: a.icon?.startsWith('https://') ? a.icon : null,
    ageSeconds: Math.max(0, Math.round((now - createdAtMs) / 1000)),
    liquidityUsd: num(pool.liquidity) ?? 0,
    marketCapUsd,
    volume5mUsd: s5 ? (s5.buyVolume ?? 0) + (s5.sellVolume ?? 0) : null,
    traders5m: num(s5?.numTraders),
    riskFlags: riskFlags(a),
    createdAtMs,
    curvePct: column === 'migrated' ? 100 : Math.max(0, Math.min(100, num(pool.bondingCurve) ?? 0)),
    holders: num(a.holderCount),
    buys5m: num(s5?.numBuys),
    sells5m: num(s5?.numSells),
    priceChange5mPct: num(s5?.priceChange),
    devPct: num(a.audit?.devBalancePercentage),
    topHoldersPct: num(a.audit?.topHoldersPercentage),
    socials: socialsOf(a),
    column,
    launchpad: a.launchpad ?? null,
    graduatedAtMs: ms(a.graduatedAt),
    snipersPct: num(a.audit?.sniperPct),
    insidersPct: num(a.audit?.insiderPct),
    bundlersPct: num(a.audit?.bundlerStats?.holdingPct),
  };
}

/** Exported for tests. Newest launches first; closest to the finish line; newest migrations. */
export function sortColumn(column: XxxRiskColumn, list: XxxRiskToken[]): XxxRiskToken[] {
  if (column === 'soon') return list.sort((a, b) => (b.curvePct ?? 0) - (a.curvePct ?? 0));
  if (column === 'migrated') return list.sort((a, b) => (b.graduatedAtMs ?? b.createdAtMs ?? 0) - (a.graduatedAtMs ?? a.createdAtMs ?? 0));
  return list.sort((a, b) => a.ageSeconds - b.ageSeconds);
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
 * audit, picture, holders, socials) and sorted newest first (2026-10-28, card grid). Rebuilt with the other feeds every ~10s, cached in
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

  /**
   * Three GMGN-style columns (owner 2026-10-28: "huge variety of coins"): Jupiter's launchpad
   * board (every Solana launchpad — Pump.fun, Meteora, LaunchLab, …) twice — its newest and,
   * for variety, its bigger ones — plus Kamby's own fresh Pump.fun launches for the New column.
   * Two board calls and one token search per cycle; if the board is down, New still fills.
   */
  async build(): Promise<XxxRiskToken[]> {
    const now = Date.now();
    const [board, own] = await Promise.all([this.board(now), this.ownLaunches(now)]);
    const seen = new Set<string>();
    const columns: Record<XxxRiskColumn, XxxRiskToken[]> = { new: [], soon: [], migrated: [] };
    for (const token of [...board, ...own]) {
      if (seen.has(token.mintAddress)) continue;
      seen.add(token.mintAddress);
      columns[token.column ?? 'new'].push(token);
    }
    const top = (['new', 'soon', 'migrated'] as const).flatMap((c) => sortColumn(c, columns[c]).slice(0, PER_COLUMN)).slice(0, XXXRISK_FILTER.limit);
    await this.redis.set(REDIS_KEY, JSON.stringify(top), 'EX', REDIS_TTL_SECONDS).catch(() => undefined);
    return top;
  }

  /** Jupiter's launchpad board: 30 per column per call, so a second call with market-cap
   *  floors brings in different (bigger) coins. */
  private async board(now: number): Promise<XxxRiskToken[]> {
    const bodies = [
      { recent: { timeframe: '24h' }, aboutToGraduate: { timeframe: '24h' }, graduated: { timeframe: '24h' } },
      { recent: { timeframe: '24h', minMcap: 8_000 }, aboutToGraduate: { timeframe: '24h', minMcap: 30_000 }, graduated: { timeframe: '24h', minMcap: 60_000 } },
    ];
    const replies = await Promise.all(
      bodies.map(async (body) => {
        try {
          const res = await fetch(GEMS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) });
          return res.ok ? ((await res.json()) as GemsBody) : null;
        } catch (error) {
          this.logger.warn({ err: error }, 'XXXRisk: launchpad board unavailable this cycle');
          return null;
        }
      }),
    );
    const out: XxxRiskToken[] = [];
    for (const reply of replies) {
      if (!reply) continue;
      for (const [key, column] of [['recent', 'new'], ['aboutToGraduate', 'soon'], ['graduated', 'migrated']] as const) {
        for (const pool of reply[key]?.pools ?? []) {
          const token = gemsToken(pool, column, now);
          if (token) out.push(token);
        }
      }
    }
    return out;
  }

  /** Kamby's own Pump.fun launches (PumpPortal + on-chain curve reads), enriched with one
   *  Jupiter search — the original XXXRisk list, now a second source for the New column. */
  private async ownLaunches(now: number): Promise<XxxRiskToken[]> {
    const solUsd = this.cryptoPrices.snapshot().find((p) => p.symbol === 'SOL')?.priceUsd;
    if (!solUsd) return [];
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
        createdAtMs: row.createdAt.getTime(),
        curvePct: pumpFunGraduationProgressPct(row.realSolReserves),
        holders: num(j?.holderCount),
        buys5m: num(j?.stats5m?.numBuys),
        sells5m: num(j?.stats5m?.numSells),
        priceChange5mPct: num(j?.stats5m?.priceChange),
        devPct: num(j?.audit?.devBalancePercentage),
        topHoldersPct: num(j?.audit?.topHoldersPercentage),
        socials: socialsOf(j),
        column: 'new' as const,
        launchpad: 'pump.fun',
        snipersPct: num(j?.audit?.sniperPct),
        insidersPct: num(j?.audit?.insiderPct),
        bundlersPct: num(j?.audit?.bundlerStats?.holdingPct),
      };
    });
    return tokens;
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
