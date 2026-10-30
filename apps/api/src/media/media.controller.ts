import { Controller, Get, Header, Headers, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { R2StorageService } from './r2-storage.service';

/** Public profile pictures (2026-10-18) — see R2StorageService#uploadAvatar's fallback. */
@Controller('media')
export class MediaController {
  constructor(private readonly r2: R2StorageService) {}

  @Get('avatars/:userId/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  // The app (kambesh.com) shows these from this API's own origin — helmet's default
  // same-origin resource policy made every picture a broken image (2026-10-18).
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @SkipThrottle()
  async avatar(@Param('userId') userId: string, @Param('file') file: string): Promise<StreamableFile> {
    const picture = await this.r2.getAvatar(userId, file);
    return new StreamableFile(Buffer.from(picture.body), { type: picture.contentType });
  }

  /** Feed videos (2026-10-30) — in byte ranges, so phones can stream and seek. */
  @Get('feedvideo/:userId/:file')
  @SkipThrottle()
  async feedVideo(@Param('userId') userId: string, @Param('file') file: string, @Headers('range') range: string | undefined, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const part = await this.r2.getFeedVideo(userId, file, range);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (part.contentRange) {
      res.status(206);
      res.setHeader('Content-Range', part.contentRange);
    }
    return new StreamableFile(Buffer.from(part.body), { type: part.contentType, length: part.body.byteLength });
  }

  /** Feed photos (2026-10-30) — only ever stored after passing moderation. */
  @Get('feed/:userId/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @SkipThrottle()
  async feedPhoto(@Param('userId') userId: string, @Param('file') file: string): Promise<StreamableFile> {
    const picture = await this.r2.getFeedPhoto(userId, file);
    return new StreamableFile(Buffer.from(picture.body), { type: picture.contentType });
  }
}
