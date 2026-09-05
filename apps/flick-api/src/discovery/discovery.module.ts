import { Module } from '@nestjs/common';
import { MoviesModule } from '../movies/movies.module';
import { EngagementModule } from '../engagement/engagement.module';
import { DiscoveryService } from './discovery.service';
import { DiscoveryController } from './discovery.controller';

@Module({
  imports: [MoviesModule, EngagementModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
