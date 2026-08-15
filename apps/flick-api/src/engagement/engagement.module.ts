import { Module } from '@nestjs/common';
import { EngagementService } from './engagement.service';
import { EngagementController } from './engagement.controller';
import { PlaybackModule } from '../playback/playback.module';

@Module({
  imports: [PlaybackModule],
  controllers: [EngagementController],
  providers: [EngagementService],
})
export class EngagementModule {}
