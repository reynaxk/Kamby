import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';

/** What Sightengine's nudity-2.1, weapon and gore-2.0 models return (only the parts read here). */
export interface SightengineResult {
  status?: string;
  nudity?: { sexual_activity?: number; sexual_display?: number; erotica?: number; very_suggestive?: number };
  weapon?: { classes?: { firearm?: number; knife?: number } };
  gore?: { prob?: number };
}

/** Over any of these, the picture is refused. Stricter than Sightengine's own examples on
 *  purpose: Kamby is public and its owner is a minor. */
const LIMITS = { sexualActivity: 0.2, sexualDisplay: 0.2, erotica: 0.35, verySuggestive: 0.7, gore: 0.4, firearm: 0.7, knife: 0.8 } as const;

/** The verdict for one Sightengine answer — a pure function, so the thresholds are testable. */
export function verdict(r: SightengineResult): { ok: boolean; reason: 'nudity' | 'gore' | 'weapon' | 'error' | null } {
  if (r.status !== 'success') return { ok: false, reason: 'error' };
  const n = r.nudity ?? {};
  if ((n.sexual_activity ?? 0) >= LIMITS.sexualActivity || (n.sexual_display ?? 0) >= LIMITS.sexualDisplay || (n.erotica ?? 0) >= LIMITS.erotica || (n.very_suggestive ?? 0) >= LIMITS.verySuggestive) {
    return { ok: false, reason: 'nudity' };
  }
  if ((r.gore?.prob ?? 0) >= LIMITS.gore) return { ok: false, reason: 'gore' };
  const w = r.weapon?.classes ?? {};
  if ((w.firearm ?? 0) >= LIMITS.firearm || (w.knife ?? 0) >= LIMITS.knife) return { ok: false, reason: 'weapon' };
  return { ok: true, reason: null };
}

/**
 * Checks a picture with Sightengine before Kamby stores it (2026-10-30). Fails closed: no keys,
 * a timeout or any odd answer means "not allowed". Three models per picture = three operations.
 */
@Injectable()
export class ImageModerationService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('ImageModerationService');
  }

  isConfigured(): boolean {
    return Boolean(this.config.get('SIGHTENGINE_USER', { infer: true }) && this.config.get('SIGHTENGINE_SECRET', { infer: true }));
  }

  async check(buffer: Buffer, mimetype: string): Promise<{ ok: boolean; reason: 'nudity' | 'gore' | 'weapon' | 'error' | null }> {
    const user = this.config.get('SIGHTENGINE_USER', { infer: true });
    const secret = this.config.get('SIGHTENGINE_SECRET', { infer: true });
    if (!user || !secret) return { ok: false, reason: 'error' };
    const form = new FormData();
    form.set('models', 'nudity-2.1,weapon,gore-2.0');
    form.set('api_user', user);
    form.set('api_secret', secret);
    form.set('media', new Blob([new Uint8Array(buffer)], { type: mimetype }), 'upload');
    try {
      const res = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
      const body = (await res.json()) as SightengineResult;
      const v = verdict(body);
      if (!v.ok) this.logger.info({ reason: v.reason, status: body.status }, 'Picture refused by moderation');
      return v;
    } catch (error) {
      this.logger.warn({ err: error }, 'Sightengine check failed — picture refused');
      return { ok: false, reason: 'error' };
    }
  }
}
