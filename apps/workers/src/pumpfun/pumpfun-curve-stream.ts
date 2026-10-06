import { prisma } from '@kamby/db';
import { PublicKey, type Connection } from '@solana/web3.js';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { decodeBondingCurve, type CurveState, type PumpFunCurveRefresher } from './pumpfun-curve-refresher';

/** Live curve state per mint, read by the API's live price (LivePriceService#curvePrices). */
export const LIVE_CURVE_KEY = (mint: string) => `pf-curve-live:${mint}`;
const LIVE_TTL_SECONDS = 120;
/** How many curves are watched at once — the hot, newest and most-raised ones. */
const MAX_WATCHED = 300;
/** The watch list is re-chosen this often (new launches, graduations, cooled-off coins). */
const RESELECT_MS = 45_000;
/** Changed curves are written to Postgres in one batch this often (the lists' progress bars). */
const DB_FLUSH_MS = 5_000;

/**
 * Real-time Pump.fun bonding-curve prices (2026-10-06): a live account subscription (Helius
 * websocket) on each watched curve, so every trade lands in ~0.4s instead of on the 45s batch
 * read. Each update is decoded with the same decoder as PumpFunCurveRefresher and written to
 * Redis at once (the API prices from it); Postgres gets the latest state in 5s batches. The 45s
 * refresher keeps running underneath, so a dropped socket only means slower updates, never stale
 * ones for long.
 */
export class PumpFunCurveStream {
  private readonly subscriptions = new Map<string, { id: number; mint: string; rowId: string }>();
  private readonly pending = new Map<string, { rowId: string; state: CurveState }>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly connection: Connection,
    private readonly refresher: PumpFunCurveRefresher,
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  start(): void {
    void this.reselect();
    this.timers.push(setInterval(() => void this.reselect(), RESELECT_MS), setInterval(() => void this.flush(), DB_FLUSH_MS));
    for (const t of this.timers) t.unref?.();
  }

  private async reselect(): Promise<void> {
    try {
      const chosen = [...(await this.refresher.selectCurves()).values()].slice(0, MAX_WATCHED);
      const wanted = new Set(chosen.map((c) => c.bondingCurveAddress));
      for (const [curve, sub] of this.subscriptions) {
        if (wanted.has(curve)) continue;
        await this.connection.removeAccountChangeListener(sub.id).catch(() => undefined);
        this.subscriptions.delete(curve);
      }
      for (const c of chosen) {
        if (this.subscriptions.has(c.bondingCurveAddress)) continue;
        const id = this.connection.onAccountChange(new PublicKey(c.bondingCurveAddress), (info) => void this.onUpdate(c.bondingCurveAddress, info.data), {
          commitment: 'processed',
        });
        this.subscriptions.set(c.bondingCurveAddress, { id, mint: c.mintAddress, rowId: c.id });
      }
      this.logger.info({ watched: this.subscriptions.size }, 'Pump.fun live curves watched');
    } catch (error) {
      this.logger.warn({ err: error }, 'Pump.fun live curve reselect failed — keeping current subscriptions');
    }
  }

  private async onUpdate(curve: string, data: Buffer): Promise<void> {
    const sub = this.subscriptions.get(curve);
    const state = decodeBondingCurve(data);
    if (!sub || !state) return;
    this.pending.set(curve, { rowId: sub.rowId, state });
    const live = { virtualSolReserves: state.virtualSolReserves, virtualTokenReserves: state.virtualTokenReserves, complete: state.complete, at: Date.now() };
    await this.redis.set(LIVE_CURVE_KEY(sub.mint), JSON.stringify(live), 'EX', LIVE_TTL_SECONDS).catch(() => undefined);
  }

  private async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const { rowId, state } of batch) {
      await prisma.pumpFunToken
        .update({ where: { id: rowId }, data: { ...state, lastStateUpdateAt: new Date(), ...(state.complete ? { graduatedAt: new Date() } : {}) } })
        .catch((error: unknown) => this.logger.warn({ err: error }, 'Pump.fun live curve write failed'));
    }
  }
}
