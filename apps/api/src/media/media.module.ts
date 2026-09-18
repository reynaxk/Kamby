import { Module } from '@nestjs/common';
import { R2StorageService } from './r2-storage.service';

/** Owns Cloudflare R2 access — currently just profile-picture uploads (see
 *  R2StorageService's own doc comment). A separate module rather than folding
 *  R2StorageService into IdentityModule so any future feature needing object storage
 *  (not just profile pictures) depends on this, not on identity. */
@Module({
  providers: [R2StorageService],
  exports: [R2StorageService],
})
export class MediaModule {}
