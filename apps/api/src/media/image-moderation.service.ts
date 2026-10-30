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

/** A video's verdict: every sampled frame must pass, the clip must be short, and the answer sane. */
export function videoVerdict(r: { status?: string; data?: { frames?: (SightengineResult & { info?: { position?: number } })[] } }, maxSeconds: number) {
  const frames = r.data?.frames;
  if (r.status !== 'success' || !Array.isArray(frames) || frames.length === 0) return { ok: false, reason: 'error' as const };
  const last = Math.max(...frames.map((f) => f.info?.position ?? 0));
  if (last > maxSeconds + 1) return { ok: false, reason: 'long' as const };
  for (const f of frames) {
    const v = verdict({ ...f, status: 'success' });
    if (!v.ok) return v;
  }
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

  /** A short clip, a frame every 3 seconds (Sightengine's synchronous video check, < 1 minute). */
  async checkVideo(buffer: Buffer, mimetype: string, maxSeconds: number): Promise<{ ok: boolean; reason: string | null }> {
    const user = this.config.get('SIGHTENGINE_USER', { infer: true });
    const secret = this.config.get('SIGHTENGINE_SECRET', { infer: true });
    if (!user || !secret) return { ok: false, reason: 'error' };
    const form = new FormData();
    form.set('models', 'nudity-2.1,weapon,gore-2.0');
    form.set('interval', '3');
    form.set('api_user', user);
    form.set('api_secret', secret);
    form.set('media', new Blob([new Uint8Array(buffer)], { type: mimetype }), 'upload');
    try {
      const res = await fetch('https://api.sightengine.com/1.0/video/check-sync.json', { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
      const body = (await res.json()) as { status?: string; error?: { message?: string }; data?: { frames?: (SightengineResult & { info?: { position?: number } })[] } };
      const v = videoVerdict(body, maxSeconds);
      if (!v.ok) this.logger.info({ reason: v.reason, status: body.status, error: body.error?.message }, 'Video refused by moderation');
      return v;
    } catch (error) {
      this.logger.warn({ err: error }, 'Sightengine video check failed — video refused');
      return { ok: false, reason: 'error' };
    }
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
