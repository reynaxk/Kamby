import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { R2StorageService } from './r2-storage.service';
import { ImageModerationService } from './image-moderation.service';

/** Owns Cloudflare R2 access — currently just profile-picture uploads (see
 *  R2StorageService's own doc comment). A separate module rather than folding
 *  R2StorageService into IdentityModule so any future feature needing object storage
 *  (not just profile pictures) depends on this, not on identity. */
@Module({
  controllers: [MediaController],
  providers: [R2StorageService, ImageModerationService],
  exports: [R2StorageService, ImageModerationService],
})
export class MediaModule {}
