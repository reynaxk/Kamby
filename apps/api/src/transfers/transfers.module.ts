import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SolanaModule } from '../solana/solana.module';
import { TransferNotifyService } from './transfer-notify.service';
import { TransfersController } from './transfers.controller';

/** Send to a Kamby user (2026-10-15): the recipient's notification, verified on-chain. */
@Module({
  imports: [IdentityModule, NotificationsModule, SolanaModule],
  controllers: [TransfersController],
  providers: [TransferNotifyService],
})
export class TransfersModule {}
