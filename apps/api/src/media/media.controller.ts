import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { R2StorageService } from './r2-storage.service';

/** Public profile pictures (2026-10-18) — see R2StorageService#uploadAvatar's fallback. */
@Controller('media')
export class MediaController {
  constructor(private readonly r2: R2StorageService) {}

  @Get('avatars/:userId/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async avatar(@Param('userId') userId: string, @Param('file') file: string): Promise<StreamableFile> {
    const picture = await this.r2.getAvatar(userId, file);
    return new StreamableFile(Buffer.from(picture.body), { type: picture.contentType });
  }
}
