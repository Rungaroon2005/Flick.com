import { Module } from '@nestjs/common';
import { PlaybackService } from './playback.service';
import { PlaybackController } from './playback.controller';
import { PrismaService } from '../prisma.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [SubscriptionsModule, WalletModule],
  controllers: [PlaybackController],
  providers: [PlaybackService, PrismaService],
  exports: [PlaybackService],
})
export class PlaybackModule {}
