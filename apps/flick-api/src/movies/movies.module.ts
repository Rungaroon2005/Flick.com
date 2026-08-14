import { Logger, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { MoviesService } from './movies.service';
import { MoviesController } from './movies.controller';
import { PrismaService } from '../prisma.service';

const logger = new Logger('MoviesCache');

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: false,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');

        if (!url) {
          // No REDIS_URL configured (e.g. local dev / CI without a Redis
          // daemon) — fall back to cache-manager's default in-memory store.
          return {
            ttl: 300_000, // 5 minutes in milliseconds
            stores: [],
          };
        }

        // `disableOfflineQueue: true` matters here: node-redis's default
        // behaviour queues commands while disconnected and waits for
        // reconnection, which means a `get`/`set` call issued during an
        // outage never resolves — the request hangs instead of falling
        // back to Postgres. Disabling the offline queue makes those calls
        // fail (and reject) immediately while the client keeps retrying
        // the connection in the background, so a Redis outage degrades
        // (cache miss) instead of hanging or crashing the request.
        const keyv = new Keyv({
          store: new KeyvRedis({ url, disableOfflineQueue: true }),
        });
        // A Redis outage must not crash the API — log and keep serving,
        // degraded to querying Postgres directly on every cache miss.
        keyv.on('error', (err: Error) => {
          logger.error(`Redis cache error: ${err.message}`, err.stack);
        });

        return {
          ttl: 300_000, // 5 minutes in milliseconds
          stores: [keyv],
        };
      },
    }),
  ],
  controllers: [MoviesController],
  providers: [MoviesService, PrismaService],
})
export class MoviesModule {}
