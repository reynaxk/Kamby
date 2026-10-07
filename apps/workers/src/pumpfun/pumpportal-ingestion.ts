import { prisma } from '@kamby/db';
import { PUMPFUN_REALTIME_CHANNEL, pumpFunGraduationProgressPct, type PumpFunLiveBatch, type PumpFunTokenSummary } from '@kamby/domain';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import WebSocket from 'ws';

export const PUMPPORTAL_DATA_URL = 'wss://pumpportal.fun/api/data';

// Pump.fun's standard bonding curve, in the units PumpPortal reports (whole SOL, whole
// tokens; tokens have 6 decimals). A curve starts at 30 virtual SOL / 1,073,000,000 virtual
// tokens, 793,100,000 of them real — so real = virtual minus those fixed offsets. Checked
// against a live create event 2026-09-30: a 10 SOL initial buy reported vSol 40 = 30 + 10.
const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_UNITS = 1_000_000;
const INITIAL_VIRTUAL_SOL_LAMPORTS = 30n * BigInt(LAMPORTS_PER_SOL);
const VIRTUAL_TOKEN_OFFSET_RAW = 279_900_000n * BigInt(TOKEN_UNITS); // 1,073,000,000 - 793,100,000
const TOKEN_TOTAL_SUPPLY_RAW = (1_000_000_000n * BigInt(TOKEN_UNITS)).toString();

/** How often buffered state is written to Postgres and published to the API. */
const FLUSH_INTERVAL_MS = 2_000;
/** Trade subscriptions held at once — the newest launches plus anything climbing. */
export const MAX_TRACKED_MINTS = 1_500;
/** A tracked mint at or above this progress is kept past its age-based eviction turn. */
const KEEP_TRACKING_PROGRESS_PCT = 50;
/** Most token updates published per flush (the API only needs what changed). */
const MAX_PUBLISHED_PER_FLUSH = 300;
/** No message at all for this long = a dead socket, reconnect. Launches arrive every few seconds. */
const SILENCE_TIMEOUT_MS = 60_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
/** Live trade prices go to Redis this often (latest trade per mint wins) — see LIVE_CURVE_KEY. */
const LIVE_WRITE_MS = 300;
const LIVE_TTL_SECONDS = 120;
/** Coins shown in Kamby's lists (Jupiter-hot set) are added to the trade subscriptions this often. */
const HOT_SYNC_MS = 30_000;
/** Same key the API's LivePriceService#liveCurvePrices reads. */
export const LIVE_CURVE_KEY = (mint: string) => `pf-curve-live:${mint}`;
export const PUMPFUN_HOT_MINTS_KEY_FOR_STREAM = 'pumpfun:hot-mints';

interface CurveState {
  virtualSolReserves: string;
  virtualTokenReserves: string;
  realSolReserves: string;
  realTokenReserves: string;
}

interface PendingToken {
  mintAddress: string;
  create?: { bondingCurveAddress: string; creatorAddress: string | null; name: string | null; symbol: string | null; uri: string | null };
  state?: CurveState;
  migrated?: boolean;
}

/** PumpPortal's message fields this service reads — see https://pumpportal.fun/data-api. */
interface PumpPortalMessage {
  txType?: string;
  mint?: string;
  pool?: string;
  traderPublicKey?: string;
  bondingCurveKey?: string;
  vSolInBondingCurve?: number;
  vTokensInBondingCurve?: number;
  name?: string;
  symbol?: string;
  uri?: string;
}

/** Exported for tests. Converts PumpPortal's whole-unit floats into the raw on-chain
 *  reserve strings PumpFunToken stores. Null if the numbers are missing or nonsensical. */
export function curveStateFromPumpPortal(vSol: unknown, vTokens: unknown): CurveState | null {
  if (typeof vSol !== 'number' || typeof vTokens !== 'number' || !Number.isFinite(vSol) || !Number.isFinite(vTokens) || vSol <= 0 || vTokens <= 0) return null;
  const virtualSol = BigInt(Math.round(vSol * LAMPORTS_PER_SOL));
  const virtualTokens = BigInt(Math.round(vTokens * TOKEN_UNITS));
  const realSol = virtualSol > INITIAL_VIRTUAL_SOL_LAMPORTS ? virtualSol - INITIAL_VIRTUAL_SOL_LAMPORTS : 0n;
  const realTokens = virtualTokens > VIRTUAL_TOKEN_OFFSET_RAW ? virtualTokens - VIRTUAL_TOKEN_OFFSET_RAW : 0n;
  return {
    virtualSolReserves: virtualSol.toString(),
    virtualTokenReserves: virtualTokens.toString(),
    realSolReserves: realSol.toString(),
    realTokenReserves: realTokens.toString(),
  };
}

/**
 * Pump.fun bonding-curve ingestion from PumpPortal's free data stream — replaces
 * PumpFunIngestionService's `logsSubscribe` on the Pump.fun program over paid Solana RPC
 * (see PUMPFUN_SOURCE in config/env.ts). That subscription carried every Pump.fun event on
 * the network through a paid endpoint and was dropping events under backpressure in
 * production (2026-09-30); PumpPortal delivers the same create/trade/graduation events
 * pre-decoded over one free WebSocket.
 *
 * Writes the same PumpFunToken rows the old ingestion did (so the existing trenches API
 * keeps working unchanged) and publishes each flush's changed tokens on
 * PUMPFUN_REALTIME_CHANNEL for the API's live stream.
 *
 * Load discipline, learned from the 2026-09-15 incident where per-event Prisma writes
 * exhausted Postgres connections: events only update an in-memory buffer (latest state per
 * mint wins), and one flush every FLUSH_INTERVAL_MS writes it — one createMany for new
 * launches, then one update per changed mint, strictly sequentially. A burst of 1,000 trades
 * on one coin is one row write.
 *
 * Only the default Pump.fun curve (`pool: 'pump'`) is tracked. Trade events for a mint that
 * was created before this process was watching are skipped unless its row already exists —
 * the same "never half-create a row" rule as the old ingestion.
 */
export class PumpPortalIngestionService {
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private liveTimer: NodeJS.Timeout | null = null;
  private hotTimer: NodeJS.Timeout | null = null;
  /** Latest curve per mint since the last live write — every trade, free, no RPC credits. */
  private readonly liveDirty = new Map<string, CurveState>();
  private readonly pending = new Map<string, PendingToken>();
  /** Mints with an active trade subscription, oldest first (Map keeps insertion order). */
  private readonly tracked = new Map<string, number>();
  /** Last known progress per tracked mint — decides who survives eviction. */
  private readonly progress = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    private readonly redis: Redis | null,
    private readonly url: string = PUMPPORTAL_DATA_URL,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.liveTimer = setInterval(() => void this.writeLive(), LIVE_WRITE_MS);
    this.hotTimer = setInterval(() => void this.syncHotMints(), HOT_SYNC_MS);
  }

  /** Real-time prices (2026-10-07): each trade's curve goes to Redis within LIVE_WRITE_MS,
   *  so the API prices bonding coins from the latest trade instead of DexScreener's poll. */
  private async writeLive(): Promise<void> {
    if (!this.redis || this.liveDirty.size === 0) return;
    const at = Date.now();
    const pipe = this.redis.pipeline();
    for (const [mint, state] of this.liveDirty) {
      pipe.set(LIVE_CURVE_KEY(mint), JSON.stringify({ virtualSolReserves: state.virtualSolReserves, virtualTokenReserves: state.virtualTokenReserves, complete: false, at }), 'EX', LIVE_TTL_SECONDS);
    }
    this.liveDirty.clear();
    await pipe.exec().catch((error: unknown) => this.logger.warn({ err: error }, 'PumpPortal: live price write failed'));
  }

  /** Makes sure every bonding coin Kamby's lists show is trade-subscribed, kept like a climber. */
  private async syncHotMints(): Promise<void> {
    if (!this.redis) return;
    const hot = await this.redis.smembers(PUMPFUN_HOT_MINTS_KEY_FOR_STREAM).catch(() => [] as string[]);
    for (const mint of hot.slice(0, 500)) if (!this.tracked.has(mint)) this.track(mint, KEEP_TRACKING_PROGRESS_PCT);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    if (this.hotTimer) clearInterval(this.hotTimer);
    this.socket?.close();
    this.socket = null;
    await this.flush();
  }

  private connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.on('open', () => {
      this.reconnectAttempt = 0;
      this.logger.info('PumpPortal stream connected');
      socket.send(JSON.stringify({ method: 'subscribeNewToken' }));
      socket.send(JSON.stringify({ method: 'subscribeMigration' }));
      void this.resubscribeTrades();
      this.armSilenceTimer();
    });
    socket.on('message', (raw) => {
      this.armSilenceTimer();
      try {
        this.handleMessage(JSON.parse(raw.toString()) as PumpPortalMessage);
      } catch {
        // A malformed frame is skipped, never allowed to kill the stream.
      }
    });
    socket.on('close', () => this.scheduleReconnect());
    socket.on('error', (error) => {
      this.logger.warn({ err: error }, 'PumpPortal stream error');
      socket.close();
    });
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.logger.warn('PumpPortal stream silent for 60s — reconnecting');
      this.socket?.terminate();
    }, SILENCE_TIMEOUT_MS);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** After a (re)connect, trade subscriptions are gone — re-subscribe what was tracked, or on
   *  first start, the most recently active incomplete curves already in the database. */
  private async resubscribeTrades(): Promise<void> {
    if (this.tracked.size === 0) {
      try {
        const recent = await prisma.pumpFunToken.findMany({
          where: { complete: false },
          orderBy: { lastStateUpdateAt: 'desc' },
          take: Math.floor(MAX_TRACKED_MINTS / 2),
          select: { mintAddress: true, realSolReserves: true },
        });
        for (const row of recent.reverse()) {
          this.tracked.set(row.mintAddress, Date.now());
          this.progress.set(row.mintAddress, pumpFunGraduationProgressPct(row.realSolReserves));
        }
      } catch (error) {
        this.logger.warn({ err: error }, 'PumpPortal: could not load recent curves to re-subscribe');
      }
    }
    const keys = [...this.tracked.keys()];
    for (let i = 0; i < keys.length; i += 500) this.send({ method: 'subscribeTokenTrade', keys: keys.slice(i, i + 500) });
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /** Exposed for tests. */
  handleMessage(message: PumpPortalMessage): void {
    const mint = message.mint;
    if (!mint) return;
    if (message.txType === 'migrate') {
      this.upsertPending(mint).migrated = true;
      this.liveDirty.delete(mint);
      if (typeof this.redis?.del === 'function') void this.redis.del(LIVE_CURVE_KEY(mint)).catch(() => undefined);
      this.untrack(mint);
      return;
    }
    if (message.pool !== undefined && message.pool !== 'pump') return;
    const state = curveStateFromPumpPortal(message.vSolInBondingCurve, message.vTokensInBondingCurve);
    if (message.txType === 'create') {
      if (!state || !message.bondingCurveKey) return;
      const entry = this.upsertPending(mint);
      entry.create = {
        bondingCurveAddress: message.bondingCurveKey,
        creatorAddress: message.traderPublicKey ?? null,
        name: message.name ?? null,
        symbol: message.symbol ?? null,
        uri: message.uri ?? null,
      };
      entry.state = state;
      this.track(mint, pumpFunGraduationProgressPct(state.realSolReserves));
      return;
    }
    if ((message.txType === 'buy' || message.txType === 'sell') && state) {
      this.upsertPending(mint).state = state;
      this.liveDirty.set(mint, state);
      if (this.tracked.has(mint)) this.progress.set(mint, pumpFunGraduationProgressPct(state.realSolReserves));
    }
  }

  private upsertPending(mint: string): PendingToken {
    let entry = this.pending.get(mint);
    if (!entry) {
      entry = { mintAddress: mint };
      this.pending.set(mint, entry);
    }
    return entry;
  }

  private track(mint: string, progressPct: number): void {
    if (!this.tracked.has(mint)) {
      this.tracked.set(mint, Date.now());
      this.send({ method: 'subscribeTokenTrade', keys: [mint] });
    }
    this.progress.set(mint, progressPct);
    while (this.tracked.size > MAX_TRACKED_MINTS) this.evictOne();
  }

  /** Drops the oldest tracked mint that isn't climbing; if every one is, the oldest. */
  private evictOne(): void {
    let victim: string | undefined;
    for (const mint of this.tracked.keys()) {
      if ((this.progress.get(mint) ?? 0) < KEEP_TRACKING_PROGRESS_PCT) {
        victim = mint;
        break;
      }
    }
    victim ??= this.tracked.keys().next().value;
    if (victim) this.untrack(victim);
  }

  private untrack(mint: string): void {
    if (!this.tracked.delete(mint)) return;
    this.progress.delete(mint);
    this.send({ method: 'unsubscribeTokenTrade', keys: [mint] });
  }

  /** Exposed for tests. Writes the buffer, then publishes what changed. Never overlaps itself. */
  async flush(): Promise<void> {
    if (this.flushing || this.pending.size === 0) return;
    this.flushing = true;
    const batch = [...this.pending.values()];
    this.pending.clear();
    try {
      const now = new Date();
      const creates = batch.filter((t) => t.create && t.state);
      if (creates.length > 0) {
        await prisma.pumpFunToken.createMany({
          data: creates.map((t) => ({
            mintAddress: t.mintAddress,
            bondingCurveAddress: t.create!.bondingCurveAddress,
            creatorAddress: t.create!.creatorAddress,
            name: t.create!.name,
            symbol: t.create!.symbol,
            uri: t.create!.uri,
            ...t.state!,
            tokenTotalSupply: TOKEN_TOTAL_SUPPLY_RAW,
            lastStateUpdateAt: now,
          })),
          skipDuplicates: true,
        });
      }
      for (const token of batch) {
        if (token.state && !token.create) {
          await prisma.pumpFunToken.updateMany({ where: { mintAddress: token.mintAddress }, data: { ...token.state, lastStateUpdateAt: now } });
        }
        if (token.migrated) {
          // graduatedAt is set once, on first observation — never moved by a repeat event.
          await prisma.pumpFunToken.updateMany({ where: { mintAddress: token.mintAddress, graduatedAt: null }, data: { complete: true, graduatedAt: now, lastStateUpdateAt: now } });
          await prisma.pumpFunToken.updateMany({ where: { mintAddress: token.mintAddress }, data: { complete: true } });
        }
      }
      await this.publish(batch.map((t) => t.mintAddress));
    } catch (error) {
      this.logger.error({ err: error, tokens: batch.length }, 'PumpPortal: flush failed — this batch is dropped, later events carry fresh state');
    } finally {
      this.flushing = false;
    }
  }

  /** Publishes the stored rows (never the raw buffer) so a trade for an untracked, unknown
   *  mint — skipped by updateMany — is never announced as if it existed. */
  private async publish(mints: string[]): Promise<void> {
    if (!this.redis || mints.length === 0) return;
    const rows = await prisma.pumpFunToken.findMany({ where: { mintAddress: { in: mints.slice(0, MAX_PUBLISHED_PER_FLUSH) } } });
    if (rows.length === 0) return;
    const payload: PumpFunLiveBatch = { tokens: rows.map(toLiveSummary), atIso: new Date().toISOString() };
    await this.redis.publish(PUMPFUN_REALTIME_CHANNEL, JSON.stringify(payload));
  }
}

function toLiveSummary(row: {
  mintAddress: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  virtualSolReserves: string;
  virtualTokenReserves: string;
  realSolReserves: string;
  realTokenReserves: string;
  tokenTotalSupply: string;
  complete: boolean;
  createdAt: Date;
  graduatedAt: Date | null;
}): PumpFunTokenSummary {
  return {
    mintAddress: row.mintAddress,
    name: row.name,
    symbol: row.symbol,
    uri: row.uri,
    virtualSolReserves: row.virtualSolReserves,
    virtualTokenReserves: row.virtualTokenReserves,
    realSolReserves: row.realSolReserves,
    realTokenReserves: row.realTokenReserves,
    tokenTotalSupply: row.tokenTotalSupply,
    graduationProgressPct: pumpFunGraduationProgressPct(row.realSolReserves),
    complete: row.complete,
    createdAt: row.createdAt.toISOString(),
    graduatedAt: row.graduatedAt?.toISOString() ?? null,
  };
}
