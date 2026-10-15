import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { LAUNCH_LIMITS } from '@kamby/domain';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { LaunchpadService } from './launchpad.service';


/** Kamby's LaunchPad. The logo and metadata reads are public (the coin's on-chain `uri`). */
@Controller('launchpad')
export class LaunchpadController {
  constructor(private readonly launchpad: LaunchpadService) {}

  @Get('config')
  config() {
    return this.launchpad.config();
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('assets')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: LAUNCH_LIMITS.imageMaxBytes } }))
  upload(@UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined, @CurrentUser() user: SessionUser) {
    if (!file) throw new BadRequestException('Add the coin logo (a PNG, JPEG, GIF or WebP image).');
    return this.launchpad.uploadImage(user.id, file);
  }

  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('assets/:id')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async asset(@Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) res: Response) {
    const { contentType, bytes } = await this.launchpad.asset(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return new StreamableFile(bytes);
  }

  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('metadata/:id')
  @Header('Cache-Control', 'public, max-age=300')
  metadata(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.launchpad.metadata(id);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('tokens/:address')
  byToken(@Param('address') address: string) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40}$/.test(address)) throw new BadRequestException('Not a coin address');
    return this.launchpad.byToken(address);
  }

  @UseGuards(JwtAuthGuard)
  @Get('launches/mine')
  mine(@CurrentUser() user: SessionUser) {
    return this.launchpad.mine(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('launches')
  prepare(@Body() body: unknown, @CurrentUser() user: SessionUser) {
    return this.launchpad.prepare(user.id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('launches/:id/fund')
  fund(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @CurrentUser() user: SessionUser) {
    return this.launchpad.fund(user.id, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('launches/:id/create')
  create(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: SessionUser) {
    return this.launchpad.create(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('launches/:id/submit')
  submit(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @CurrentUser() user: SessionUser) {
    return this.launchpad.submit(user.id, id, body);
  }
}
