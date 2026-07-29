import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { MoviesService } from './movies.service';
import { MoviesController } from './movies.controller';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [
    CacheModule.register({
      ttl: 300000, // 5 minutes in milliseconds
    }),
  ],
  controllers: [MoviesController],
  providers: [MoviesService, PrismaService],
})
export class MoviesModule {}
