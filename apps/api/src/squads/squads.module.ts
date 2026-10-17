import { Module } from '@nestjs/common';
import { DmModule } from '../dm/dm.module';
import { IdentityModule } from '../identity/identity.module';
import { SquadsController, SquadsService } from './squads';

/** Squad Wars (2026-10-17) — see SquadsService. */
@Module({
  imports: [IdentityModule, DmModule],
  controllers: [SquadsController],
  providers: [SquadsService],
})
export class SquadsModule {}
