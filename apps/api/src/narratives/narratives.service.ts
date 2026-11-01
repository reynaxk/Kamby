import { Inject, Injectable } from '@nestjs/common';
import { prisma } from '@kamby/db';
import {
  NARRATIVES,
  heatIndex,
  narrativesOf,
  sparkFromChanges,
  tokenHeat,
  type LiveRoom,
  type NarrativeSignals,
  type NarrativeSummary,
  type NarrativeToken,
  type NarrativesSnapshot,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { from, shareReplay, switchMap, timer, catchError, EMPTY, type Observable } from 'rxjs';
import { LiveService } from '../live/live.service';
import { MarketFeedsService } from '../market-feeds/market-feeds.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { LeaderboardService } from '../social/services/leaderboard.service';

const CACHE_KEY = 'kamby:narratives:v1';
const CACHE_TTL_SECONDS = 45;
export const NARRATIVES_REFRESH_MS = 30_000;
const DEX_CHAIN: Record<string, string> = { solana: 'solana', 'eip155:8453': 'base', 'eip155:56': 'bsc', 'eip155:4663': 'robinhood' };
const DEX_BATCH = 30;
const FETCH_TIMEOUT_MS = 5_000;
const TOKENS_PER_NARRATIVE = 25;
const TOP_TRADERS = 50;

/** The parts of a DexScreener pair this reads. */
export interface NarrativePair {
  chainId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h1?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  marketCap?: number;
  fdv?: number;
  info?: { imageUrl?: string };
}

interface Coin {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
}

const key = (chainIdentifier: string, address: string) => `${chainIdentifier}:${chainIdentifier.startsWith('eip155:') ? address.toLowerCase() : address}`;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Exported for tests. A coin's own deepest pool, as a NarrativeToken (null when it has none). */
export function tokenFromPairs(coin: Coin, pairs: NarrativePair[]): NarrativeToken | null {
  const own = pairs
    .filter((p) => p.baseToken?.address && key(coin.chainIdentifier, p.baseToken.address) === key(coin.chainIdentifier, coin.tokenAddress) && Number(p.priceUsd) > 0)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const best = own[0];
  if (!best) return null;
  const priceUsd = Number(best.priceUsd);
  const token: NarrativeToken = {
    chainIdentifier: coin.chainIdentifier,
    tokenAddress: coin.tokenAddress,
    symbol: coin.symbol ?? best.baseToken?.symbol ?? null,
    name: coin.name ?? best.baseToken?.name ?? null,
    logoUrl: coin.logoUrl ?? (best.info?.imageUrl?.startsWith('https://') ? best.info.imageUrl : null),
    priceUsd,
    change1hPct: num(best.priceChange?.h1),
    change24hPct: num(best.priceChange?.h24),
    volume1hUsd: num(best.volume?.h1),
    volume24hUsd: num(best.volume?.h24),
    liquidityUsd: num(best.liquidity?.usd),
    marketCapUsd: num(best.marketCap) ?? num(best.fdv),
    spark: sparkFromChanges(priceUsd, best.priceChange ?? {}),
    heat: 0,
  };
  token.heat = tokenHeat(token);
  return token;
}

/** Exported for tests. One narrative's summary from its coins and the Kamby-side signals. */
export function summarize(
  def: (typeof NARRATIVES)[number],
  tokens: NarrativeToken[],
  extra: { kambyTrades1h: number; leaderNetBuys: number; live: NarrativeSummary['live'] },
): Omit<NarrativeSummary, 'heat'> {
  const sum = (pick: (t: NarrativeToken) => number | null) => tokens.reduce((acc, t) => acc + (pick(t) ?? 0), 0);
  const volume1hUsd = sum((t) => t.volume1hUsd);
  const volume24hUsd = sum((t) => t.volume24hUsd);
  const weighted = tokens.filter((t) => t.change24hPct !== null && (t.volume24hUsd ?? 0) > 0);
  const weight = weighted.reduce((acc, t) => acc + (t.volume24hUsd ?? 0), 0);
  const signals: NarrativeSignals = {
    volumeAcceleration: volume24hUsd > 0 ? (volume1hUsd * 24) / volume24hUsd : null,
    kambyTrades1h: extra.kambyTrades1h,
    liveViewers: extra.live.reduce((acc, r) => acc + r.viewers, 0),
    leaderNetBuys: extra.leaderNetBuys,
  };
  return {
    id: def.id,
    name: def.name,
    emoji: def.emoji,
    marketCapUsd: sum((t) => t.marketCapUsd),
    liquidityUsd: sum((t) => t.liquidityUsd),
    volume1hUsd,
    volume24hUsd,
    change24hPct: weight > 0 ? weighted.reduce((acc, t) => acc + (t.change24hPct ?? 0) * (t.volume24hUsd ?? 0), 0) / weight : null,
    tokenCount: tokens.length,
    tokens: [...tokens].sort((a, b) => b.heat - a.heat || (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0)).slice(0, TOKENS_PER_NARRATIVE),
    live: extra.live,
    signals,
  };
}

/**
 * Narratives (2026-10-31): Kamby's coins (the trending and new lists plus each narrative's
 * verified seeds) grouped by narrative, priced from their own DexScreener pools, and scored
 * with a Heat Index from real activity — volume acceleration, Kamby trades in the last hour,
 * live-stream viewers on those coins, and this week's top traders' net buys. Rebuilt at most
 * every ~30s (Redis-cached across API instances) and streamed to the app.
 */
@Injectable()
export class NarrativesService {
  private building: Promise<NarrativesSnapshot> | null = null;
  readonly updates$: Observable<NarrativesSnapshot>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly feeds: MarketFeedsService,
    private readonly live: LiveService,
    private readonly leaderboard: LeaderboardService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('NarrativesService');
    this.updates$ = timer(0, NARRATIVES_REFRESH_MS).pipe(
      switchMap(() => from(this.snapshot()).pipe(catchError(() => EMPTY))),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  async snapshot(): Promise<NarrativesSnapshot> {
    try {
      const hit = await this.redis.get(CACHE_KEY);
      if (hit) return JSON.parse(hit) as NarrativesSnapshot;
    } catch {
      // build fresh
    }
    this.building ??= this.build()
      .then(async (snap) => {
        await this.redis.set(CACHE_KEY, JSON.stringify(snap), 'EX', CACHE_TTL_SECONDS).catch(() => undefined);
        return snap;
      })
      .finally(() => {
        this.building = null;
      });
    return this.building;
  }

  private async build(): Promise<NarrativesSnapshot> {
    const coins = await this.universe();
    const [tokens, kamby, rooms] = await Promise.all([this.price(coins), this.kambyActivity(), this.live.list().catch(() => [] as LiveRoom[])]);

    const byNarrative = new Map<string, NarrativeToken[]>();
    for (const token of tokens.values()) {
      for (const id of narrativesOf(token)) byNarrative.set(id, [...(byNarrative.get(id) ?? []), token]);
    }

    const drafts = NARRATIVES.flatMap((def) => {
      const list = byNarrative.get(def.id) ?? [];
      if (list.length === 0) return [];
      const keys = new Set(list.map((t) => key(t.chainIdentifier, t.tokenAddress)));
      const count = (m: Map<string, number>) => [...keys].reduce((acc, k) => acc + (m.get(k) ?? 0), 0);
      const live = rooms
        .filter((r) => r.coin && keys.has(key(r.coin.chainIdentifier, r.coin.tokenAddress)))
        .map((r) => ({ id: r.id, title: r.title, viewers: r.viewers, hostUsername: r.host.username, symbol: r.coin?.symbol ?? null }));
      return [summarize(def, list, { kambyTrades1h: count(kamby.trades1h), leaderNetBuys: count(kamby.leaderNet), live })];
    });

    // A signal nobody has anywhere right now is left out of every score (see heatIndex).
    const active = {
      volume: drafts.some((d) => d.signals.volumeAcceleration !== null),
      kamby: drafts.some((d) => d.signals.kambyTrades1h > 0),
      live: drafts.some((d) => d.signals.liveViewers > 0),
      leaders: drafts.some((d) => d.signals.leaderNetBuys > 0),
    };
    const narratives = drafts
      .map((d): NarrativeSummary => ({ ...d, heat: heatIndex(d.signals, active) }))
      .sort((a, b) => b.heat - a.heat || b.volume24hUsd - a.volume24hUsd);
    return { narratives, atIso: new Date().toISOString() };
  }

  /** Trending + new coins Kamby lists, plus every narrative's verified seeds. */
  private async universe(): Promise<Coin[]> {
    const out = new Map<string, Coin>();
    try {
      const snap = await this.feeds.snapshot();
      for (const m of [...snap.trending.markets, ...snap.graduated.markets]) {
        out.set(key(m.chainIdentifier, m.tokenAddress), { chainIdentifier: m.chainIdentifier, tokenAddress: m.tokenAddress, symbol: m.symbol, name: m.name, logoUrl: m.logoUrl });
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Narratives: coin lists unavailable — seeds only');
    }
    for (const def of NARRATIVES) {
      for (const seed of def.seeds ?? []) {
        const k = key(seed.chainIdentifier, seed.tokenAddress);
        if (!out.has(k)) out.set(k, { ...seed, symbol: null, name: null, logoUrl: null });
      }
    }
    return [...out.values()].filter((c) => DEX_CHAIN[c.chainIdentifier]);
  }

  /** Each coin's live numbers from its own pools, 30 coins per DexScreener call. */
  private async price(coins: Coin[]): Promise<Map<string, NarrativeToken>> {
    const byChain = new Map<string, Coin[]>();
    for (const c of coins) byChain.set(c.chainIdentifier, [...(byChain.get(c.chainIdentifier) ?? []), c]);
    const result = new Map<string, NarrativeToken>();
    const jobs: Promise<void>[] = [];
    for (const [chain, list] of byChain) {
      for (let i = 0; i < list.length; i += DEX_BATCH) {
        const batch = list.slice(i, i + DEX_BATCH);
        jobs.push(
          (async () => {
            try {
              const res = await fetch(`https://api.dexscreener.com/tokens/v1/${DEX_CHAIN[chain]}/${batch.map((c) => c.tokenAddress).join(',')}`, {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
              });
              if (!res.ok) return;
              const body = (await res.json()) as unknown;
              const pairs = Array.isArray(body) ? (body as NarrativePair[]) : [];
              for (const coin of batch) {
                const token = tokenFromPairs(coin, pairs);
                if (token) result.set(key(coin.chainIdentifier, coin.tokenAddress), token);
              }
            } catch (error) {
              this.logger.warn({ err: error, chain }, 'Narratives: DexScreener batch failed');
            }
          })(),
        );
      }
    }
    await Promise.all(jobs);
    return result;
  }

  /** Confirmed Kamby trades per coin in the last hour, and top traders' buys − sells in 24h. */
  private async kambyActivity(): Promise<{ trades1h: Map<string, number>; leaderNet: Map<string, number> }> {
    const trades1h = new Map<string, number>();
    const leaderNet = new Map<string, number>();
    const hourAgo = new Date(Date.now() - 3_600_000);
    const dayAgo = new Date(Date.now() - 86_400_000);
    try {
      const [leaders, evm, sol] = await Promise.all([
        this.leaderboard.getLeaderboard('7d', TOP_TRADERS).then((b) => new Set(b.entries.map((e) => e.userId))).catch(() => new Set<string>()),
        prisma.tradeTransaction.findMany({
          where: { status: 'CONFIRMED', confirmedAt: { gte: dayAgo } },
          select: { side: true, userId: true, confirmedAt: true, tokenMarket: { select: { chain: { select: { identifier: true } }, token: { select: { contractAddress: true } } } } },
          take: 5000,
        }),
        prisma.solanaTradeTransaction.findMany({
          where: { status: 'CONFIRMED', confirmedAt: { gte: dayAgo } },
          select: { side: true, userId: true, confirmedAt: true, inputMint: true, outputMint: true },
          take: 5000,
        }),
      ]);
      const rows = [
        ...evm.map((t) => ({ k: key(t.tokenMarket.chain.identifier, t.tokenMarket.token.contractAddress), side: t.side, userId: t.userId, at: t.confirmedAt })),
        ...sol.map((t) => ({ k: key('solana', t.side === 'BUY' ? t.outputMint : t.inputMint), side: t.side, userId: t.userId, at: t.confirmedAt })),
      ];
      for (const r of rows) {
        if (r.at && r.at >= hourAgo) trades1h.set(r.k, (trades1h.get(r.k) ?? 0) + 1);
        if (leaders.has(r.userId)) leaderNet.set(r.k, (leaderNet.get(r.k) ?? 0) + (r.side === 'BUY' ? 1 : -1));
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Narratives: Kamby activity unavailable');
    }
    return { trades1h, leaderNet };
  }
}
