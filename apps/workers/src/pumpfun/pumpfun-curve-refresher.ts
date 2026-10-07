import { prisma } from '@kamby/db';
import { PublicKey, type Connection } from '@solana/web3.js';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/** Pump.fun mints Jupiter reports as hot right now (written by JupiterSolanaDiscoveryService). */
export const PUMPFUN_HOT_MINTS_KEY = 'pumpfun:hot-mints';
const BATCH = 100;
const TOP_BY_RESERVES = 200;
const MOST_RECENT = 200; // covers the XXXRisk tab's 10-minute window

export interface CurveState {
  virtualTokenReserves: string;
  virtualSolReserves: string;
  realTokenReserves: string;
  realSolReserves: string;
  tokenTotalSupply: string;
  complete: boolean;
}

/** Exported for tests. Pump.fun's BondingCurve account: 8-byte discriminator, five u64s, a bool. */
export function decodeBondingCurve(data: Buffer): CurveState | null {
  if (data.length < 8 + 5 * 8 + 1) return null;
  const u64 = (i: number) => data.readBigUInt64LE(8 + i * 8).toString();
  return {
    virtualTokenReserves: u64(0),
    virtualSolReserves: u64(1),
    realTokenReserves: u64(2),
    realSolReserves: u64(3),
    tokenTotalSupply: u64(4),
    complete: data[8 + 5 * 8] === 1,
  };
}

/**
 * Keeps Pump.fun bonding-curve progress real (found 2026-10-03: the Bonding tab's "closest to
 * graduating" coins sat at 2–16% because only launch events arrive for free — trade updates
 * are a paid PumpPortal stream). Every tick it reads the current on-chain curve accounts for
 * the coins that matter — the ones Jupiter reports as hot, the highest known by SOL raised,
 * and the newest — in getMultipleAccountsInfo batches of 100 through the existing Solana RPC
 * (a handful of calls per tick, not per trade), and writes back the reserves and graduation.
 */
export class PumpFunCurveRefresher {
  constructor(
    private readonly connection: Connection,
    private readonly redis: Redis,
    private readonly logger: Logger,
    /** Free public RPC tried first (2026-10-07: keeps paid Helius credits for trading); the
     *  paid `connection` is only used when it fails. */
    private readonly publicConnection: Connection | null = null,
  ) {}

  /** The curves that matter right now — hot on Jupiter first, then the newest, then the most
   *  raised — keyed by curve address. Shared with PumpFunCurveStream, which watches them live. */
  async selectCurves(): Promise<Map<string, { id: string; bondingCurveAddress: string; mintAddress: string }>> {
    const hotMints = await this.redis.smembers(PUMPFUN_HOT_MINTS_KEY).catch(() => [] as string[]);
    const select = { id: true, bondingCurveAddress: true, realSolReserves: true, mintAddress: true } as const;
    const [hot, topByReserves, recent] = await Promise.all([
      hotMints.length > 0 ? prisma.pumpFunToken.findMany({ where: { mintAddress: { in: hotMints }, complete: false }, select }) : Promise.resolve([]),
      // realSolReserves is a string column, so "highest" comes from a recent pool sorted here.
      prisma.pumpFunToken.findMany({ where: { complete: false }, orderBy: { lastStateUpdateAt: 'desc' }, take: 1000, select }),
      prisma.pumpFunToken.findMany({ where: { complete: false }, orderBy: { createdAt: 'desc' }, take: MOST_RECENT, select }),
    ]);
    const top = [...topByReserves].sort((a, b) => (BigInt(b.realSolReserves) > BigInt(a.realSolReserves) ? 1 : -1)).slice(0, TOP_BY_RESERVES);
    const rows = new Map<string, { id: string; bondingCurveAddress: string; mintAddress: string }>();
    for (const r of [...hot, ...recent, ...top]) rows.set(r.bondingCurveAddress, r);
    return rows;
  }

  async run(): Promise<{ read: number; updated: number; graduated: number }> {
    const rows = await this.selectCurves();

    const addresses = [...rows.keys()];
    let updated = 0;
    let graduated = 0;
    for (let i = 0; i < addresses.length; i += BATCH) {
      const batch = addresses.slice(i, i + BATCH);
      let infos;
      try {
        const keys = batch.map((a) => new PublicKey(a));
        infos = this.publicConnection
          ? await this.publicConnection.getMultipleAccountsInfo(keys).catch(() => this.connection.getMultipleAccountsInfo(keys))
          : await this.connection.getMultipleAccountsInfo(keys);
      } catch (error) {
        this.logger.warn({ err: error }, 'Pump.fun curve refresh: RPC read failed — will retry next tick');
        continue;
      }
      for (let j = 0; j < batch.length; j++) {
        const info = infos[j];
        if (!info) continue;
        const state = decodeBondingCurve(info.data);
        if (!state) continue;
        const row = rows.get(batch[j]!)!;
        await prisma.pumpFunToken.update({
          where: { id: row.id },
          data: { ...state, lastStateUpdateAt: new Date(), ...(state.complete ? { graduatedAt: new Date() } : {}) },
        });
        updated += 1;
        if (state.complete) graduated += 1;
      }
    }
    return { read: addresses.length, updated, graduated };
  }
}
