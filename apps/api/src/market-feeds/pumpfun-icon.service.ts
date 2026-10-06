import { Inject, Injectable } from '@nestjs/common';
import type { PumpFunTokenSummary } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';

const FOUND_TTL_SECONDS = 24 * 60 * 60;
/** Jupiter usually indexes a brand-new coin within minutes — retry a miss soon. */
const MISSING_TTL_SECONDS = 5 * 60;
const BATCH = 100;
const METADATA_CONCURRENCY = 6;

/**
 * Pictures for Pump.fun coins in Trenches / Bonding / Graduated (user feedback 2026-10-03: "I
 * can't see the profile pictures… it looks so unprofessional"). Kamby only stores each coin's
 * metadata link, so icons come from Jupiter's free token search (100 coins per call), cached
 * per coin in Redis — a handful of calls a minute for the whole site, only for coins not seen
 * before.
 */
@Injectable()
export class PumpFunIconService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('PumpFunIconService');
  }

  async attach(tokens: PumpFunTokenSummary[]): Promise<PumpFunTokenSummary[]> {
    if (tokens.length === 0) return tokens;
    const keys = tokens.map((t) => `pf-icon:${t.mintAddress}`);
    let cached: (string | null)[] = [];
    try {
      cached = await this.redis.mget(...keys);
    } catch {
      return tokens;
    }
    const icons = new Map<string, string>();
    const missing: string[] = [];
    tokens.forEach((t, i) => {
      const hit = cached[i];
      if (hit === null || hit === undefined) missing.push(t.mintAddress);
      else if (hit !== '') icons.set(t.mintAddress, hit);
    });

    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const found = await this.lookup(batch);
      // Coins Jupiter doesn't know yet (2026-10-06: a quarter of Trenches had no icon): the image
      // from the coin's own metadata file, which every Pump.fun launch publishes.
      const uris = new Map(tokens.map((t) => [t.mintAddress, t.uri] as const));
      const noIcon = batch.filter((m) => !found.has(m) && uris.get(m));
      for (let j = 0; j < noIcon.length; j += METADATA_CONCURRENCY) {
        await Promise.all(
          noIcon.slice(j, j + METADATA_CONCURRENCY).map(async (mint) => {
            const image = await this.imageFromMetadata(uris.get(mint)!);
            if (image) found.set(mint, image);
          }),
        );
      }
      const pipeline = this.redis.pipeline();
      for (const mint of batch) {
        const icon = found.get(mint);
        if (icon) icons.set(mint, icon);
        pipeline.set(`pf-icon:${mint}`, icon ?? '', 'EX', icon ? FOUND_TTL_SECONDS : MISSING_TTL_SECONDS);
      }
      await pipeline.exec().catch(() => undefined);
    }
    return tokens.map((t) => ({ ...t, imageUrl: icons.get(t.mintAddress) ?? null }));
  }

  /** The `image` of a coin's metadata JSON (IPFS links moved to a fast gateway), or null. */
  private async imageFromMetadata(uri: string): Promise<string | null> {
    const viaGateway = (url: string) => url.replace(/^(?:ipfs:\/\/|https?:\/\/[^/]+\/ipfs\/)/, 'https://pump.mypinata.cloud/ipfs/');
    try {
      const res = await fetch(viaGateway(uri), { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      const meta = (await res.json()) as { image?: unknown };
      const image = typeof meta.image === 'string' ? viaGateway(meta.image.trim()) : null;
      return image && image.startsWith('https://') ? image : null;
    } catch {
      return null;
    }
  }

  private async lookup(mints: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    try {
      const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.join(',')}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return out;
      const body = (await res.json()) as { id?: string; icon?: string }[];
      for (const t of Array.isArray(body) ? body : []) {
        if (t.id && typeof t.icon === 'string' && t.icon.startsWith('https://')) out.set(t.id, t.icon);
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Pump.fun icon lookup failed — rows show their initial');
    }
    return out;
  }
}
