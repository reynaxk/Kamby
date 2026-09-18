import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env';

/** Only what `uploadAvatar` actually needs to accept — never the whole `Express.Multer.File`
 *  shape, so a test double doesn't have to fake fields (`fieldname`, `stream`, etc.) this
 *  class never reads. */
export interface UploadableFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** PNG/JPEG/WebP only — see docs/TRADER_INTELLIGENCE.md#realized-pnl's profile section.
 *  Not an exhaustive "every image format" list on purpose: an avatar is displayed at a
 *  small, fixed size everywhere it appears, so there's no real use case this excludes
 *  (SVG in particular is deliberately left off — an uploaded SVG can embed script/style
 *  content a browser would execute, a real XSS surface an avatar upload has no business
 *  opening). */
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** 2MB — an avatar is displayed small; nothing about this feature needs more, and a low
 *  cap bounds both storage cost and upload latency. Exported so the controller's multer
 *  interceptor can reject an oversized upload before it's ever fully buffered into memory —
 *  the check here stays too, as a backstop in case that interceptor config ever drifts. */
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Thin wrapper around Cloudflare R2's S3-compatible API — structured the same way
 * `KyberSwapRouter`/`OpenOceanRouter` wrap an external HTTP provider (apps/api's own
 * precedent for "one class owns one external integration's real API shape"), not a
 * general-purpose storage abstraction with providers to swap later. `apps/api` runs as a
 * plain Docker container on Railway, not a Cloudflare Worker — this is a real R2 bucket
 * accessed over R2's public S3-compatible endpoint with an access key/secret, not a
 * wrangler.jsonc binding (that's `apps/web`'s own, unrelated `IMAGES` binding, which is
 * Cloudflare's image-optimization/delivery feature, not a place to store an upload).
 *
 * Config (`R2_*` in config/env.ts) is deliberately all-optional at the schema level, same
 * "required only once actually used" convention the SOLANA_* block already follows —
 * `uploadAvatar` throws a clear, actionable error itself if called before these are set,
 * rather than blocking every other route at boot for a deployment that never uploads an
 * avatar.
 */
@Injectable()
export class R2StorageService {
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Validates content-type and size, uploads to a fresh, randomly-named object (never
   *  the client-supplied filename — no path-traversal surface, no collision with another
   *  user's upload), and returns the resulting public URL. Throws a real `BadRequestException`
   *  (never silently drops or truncates) on anything invalid, matching how `QuoteService`/
   *  `SafetyService` already throw NestJS HTTP exceptions directly from the service layer
   *  in this codebase, rather than a controller translating a generic error afterward. */
  async uploadAvatar(userId: string, file: UploadableFile): Promise<string> {
    const extension = ALLOWED_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(`Unsupported image type "${file.mimetype}" — only PNG, JPEG, and WebP are accepted`);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(`Image is too large (${file.size} bytes) — the limit is ${MAX_FILE_SIZE_BYTES} bytes`);
    }

    const client = this.getClient();
    const bucket = this.config.get('R2_BUCKET_NAME', { infer: true });
    const publicBaseUrl = this.config.get('R2_PUBLIC_BASE_URL', { infer: true });
    if (!bucket || !publicBaseUrl) throw this.notConfiguredError();

    // Randomly named, not derived from the client-supplied filename or userId alone —
    // avoids both a path-traversal surface and a predictable object key another request
    // could race/overwrite.
    const key = `avatars/${userId}/${randomUUID()}.${extension}`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return new URL(key, publicBaseUrl).toString();
  }

  private getClient(): S3Client {
    if (this.client) return this.client;
    const endpoint = this.config.get('R2_ENDPOINT', { infer: true });
    const accessKeyId = this.config.get('R2_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = this.config.get('R2_SECRET_ACCESS_KEY', { infer: true });
    if (!endpoint || !accessKeyId || !secretAccessKey) throw this.notConfiguredError();

    this.client = new S3Client({
      region: 'auto', // R2 has no real regions — "auto" is R2's own documented value here
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
    return this.client;
  }

  private notConfiguredError(): InternalServerErrorException {
    return new InternalServerErrorException(
      'Avatar uploads are not configured on this deployment (R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/R2_PUBLIC_BASE_URL) — see .env.example',
    );
  }
}

