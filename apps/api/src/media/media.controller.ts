import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
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
}
