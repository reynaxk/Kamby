import { Connection, PublicKey } from '@solana/web3.js';
import { prisma } from '@kamby/db';
import type { Logger } from 'pino';
import { PUMP_FUN_PROGRAM_ID } from './pumpfun-constants';
import { decodeCompleteEvent, decodeCreateEvent, decodeTradeEvent, extractProgramDataPayloads } from './pumpfun-event-decoder';

interface QueuedNotification {
  logs: string[];
  signature: string;
}

/** Hard cap on how many not-yet-processed notifications can queue up — protects memory
 *  under a sustained burst the drain loop can't keep up with. Dropping the oldest entry
 *  under backpressure is an acceptable loss for this kind of eventual-consistency
 *  background ingestion (see the class doc comment) — this was never a guaranteed-delivery
 *  feed, and a dropped notification just means one token's state lags until its next
 *  update arrives. */
const MAX_QUEUE_SIZE = 500;

/**
 * Real-time ingestion for Pump.fun's bonding-curve tokens (the FRESH/NEAR_GRADUATED/
 * JUST_GRADUATED trenches — see docs/TRADING.md#pump-fun-trenches). A genuine departure
 * from every other worker in this codebase: everything else here is tick-based
 * (`setInterval` polling — see market/ingestion.ts, trading/sweep.ts); discovering a
 * *newly created* token has no polling equivalent (there's no "list tokens created today"
 * RPC call), so this instead holds one persistent WebSocket log subscription open for the
 * process's lifetime.
 *
 * Deliberately doesn't decode every field Pump.fun's events carry — see
 * pumpfun-event-decoder.ts's own doc comment on why the newer multi-quote-token/creator-
 * fee/mayhem-mode fields are out of scope; this targets the default, SOL-denominated
 * bonding curve.
 *
 * A `TradeEvent`/`CompleteEvent` for a mint this service never saw a `CreateEvent` for
 * (e.g. the process started after that token already existed) is skipped, not used to
 * half-create a row — a row with no observed name/symbol/uri would be a fabricated-looking
 * placeholder for real metadata this service simply never received. That token's full
 * history isn't recoverable from this stream alone; backfill (if ever needed) is a
 * deliberately separate, not-yet-built concern.
 *
 * Every notification is queued and drained strictly one at a time (see `enqueue`/`drain`),
 * never handled inline from the onLogs callback. This is a direct fix for a real production
 * incident (2026-09-15): the first version called `handleLogs` concurrently and unbounded,
 * once per notification, straight from the callback — Pump.fun's real trade volume drove
 * enough simultaneous Prisma round-trips to exhaust Postgres's connection limit within
 * minutes of going live, with `api` nearly caught in the blast radius on the same database.
 * Serializing through one queue caps this service at exactly one in-flight batch of DB calls
 * at a time, trading burst throughput for stability — acceptable here since this is
 * eventual-consistency background ingestion, not a user-facing request path.
 */
export class PumpFunIngestionService {
  private connection: Connection | null = null;
  private subscriptionId: number | null = null;
  private readonly queue: QueuedNotification[] = [];
  private draining = false;

  constructor(
    private readonly httpUrl: string,
    private readonly wsUrl: string,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.connection) return; // already running — start() is idempotent
    this.connection = new Connection(this.httpUrl, { commitment: 'confirmed', wsEndpoint: this.wsUrl });
    this.subscriptionId = this.connection.onLogs(
      new PublicKey(PUMP_FUN_PROGRAM_ID),
      (logInfo) => this.enqueue(logInfo.logs, logInfo.signature),
      'confirmed',
    );
    this.logger.info('Pump.fun log subscription started');
  }

  async stop(): Promise<void> {
    if (this.connection && this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
    }
    this.connection = null;
    this.subscriptionId = null;
  }

  /** Exposed for tests — production only ever reaches this via the onLogs callback above.
   *  Purely synchronous: pushes onto the queue (dropping the oldest entry first if already
   *  at MAX_QUEUE_SIZE) and kicks off the drain loop. Never calls handleLogs itself, so a
   *  burst of notifications can never open more than one concurrent batch of DB calls — see
   *  this class's own doc comment for the incident this fixes. */
  enqueue(logs: string[], signature: string): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.logger.warn(
        { droppedSignature: this.queue[0]?.signature },
        'pumpfun ingestion: queue backpressure — dropping the oldest not-yet-processed notification',
      );
      this.queue.shift();
    }
    this.queue.push({ logs, signature });
    void this.drain();
  }

  /** Processes the queue strictly one notification at a time. `draining` guards re-entry —
   *  however many times `enqueue` calls this concurrently, only one loop ever actually runs,
   *  so at most one `handleLogs` call (and therefore at most one batch of Prisma round-trips)
   *  is ever in flight from this service. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let next = this.queue.shift();
      while (next) {
        try {
          await this.handleLogs(next.logs);
        } catch (error) {
          this.logger.error({ err: error, signature: next.signature }, 'pumpfun ingestion: failed to handle a queued log notification');
        }
        next = this.queue.shift();
      }
    } finally {
      this.draining = false;
    }
  }

  /** Exposed for tests — production only ever reaches this via drain() above, one queued
   *  notification at a time. */
  async handleLogs(logs: string[]): Promise<void> {
    for (const payload of extractProgramDataPayloads(logs)) {
      const created = decodeCreateEvent(payload);
      if (created) {
        await this.handleCreate(created);
        continue;
      }
      const traded = decodeTradeEvent(payload);
      if (traded) {
        await this.handleTrade(traded);
        continue;
      }
      const completed = decodeCompleteEvent(payload);
      if (completed) {
        await this.handleComplete(completed);
      }
      // Any other Pump.fun event (fee claims, admin config, ...) is not a trenches concern
      // — silently ignored, not logged as an error.
    }
  }

  private async handleCreate(event: NonNullable<ReturnType<typeof decodeCreateEvent>>): Promise<void> {
    await prisma.pumpFunToken.upsert({
      where: { mintAddress: event.mint },
      // A duplicate CreateEvent for the same mint should never happen (mints are unique by
      // construction), but if a reconnect ever replays one, update rather than error rather
      // than assume it can't.
      update: {
        name: event.name,
        symbol: event.symbol,
        uri: event.uri,
        virtualTokenReserves: event.virtualTokenReserves,
        virtualSolReserves: event.virtualSolReserves,
        realTokenReserves: event.realTokenReserves,
        tokenTotalSupply: event.tokenTotalSupply,
        lastStateUpdateAt: new Date(),
      },
      create: {
        mintAddress: event.mint,
        bondingCurveAddress: event.bondingCurve,
        creatorAddress: event.creator,
        name: event.name,
        symbol: event.symbol,
        uri: event.uri,
        virtualTokenReserves: event.virtualTokenReserves,
        virtualSolReserves: event.virtualSolReserves,
        realTokenReserves: event.realTokenReserves,
        realSolReserves: '0',
        tokenTotalSupply: event.tokenTotalSupply,
        lastStateUpdateAt: new Date(),
      },
    });
  }

  private async handleTrade(event: NonNullable<ReturnType<typeof decodeTradeEvent>>): Promise<void> {
    const existing = await prisma.pumpFunToken.findUnique({ where: { mintAddress: event.mint }, select: { id: true } });
    if (!existing) return; // see this class's own doc comment on why this is skipped, not backfilled

    await prisma.pumpFunToken.update({
      where: { mintAddress: event.mint },
      data: {
        virtualTokenReserves: event.virtualTokenReserves,
        virtualSolReserves: event.virtualSolReserves,
        realTokenReserves: event.realTokenReserves,
        realSolReserves: event.realSolReserves,
        lastStateUpdateAt: new Date(),
      },
    });
  }

  private async handleComplete(event: NonNullable<ReturnType<typeof decodeCompleteEvent>>): Promise<void> {
    const existing = await prisma.pumpFunToken.findUnique({ where: { mintAddress: event.mint }, select: { id: true, graduatedAt: true } });
    if (!existing) return; // see this class's own doc comment

    await prisma.pumpFunToken.update({
      where: { mintAddress: event.mint },
      data: {
        complete: true,
        // Set once, on first observation only — never moved forward by a later, redundant
        // CompleteEvent (shouldn't happen, but this stays correct even if it did).
        graduatedAt: existing.graduatedAt ?? new Date(),
        lastStateUpdateAt: new Date(),
      },
    });
  }
}
