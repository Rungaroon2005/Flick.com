import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/**
 * Owns the application's single Prisma client and underlying PostgreSQL pool.
 * Feature modules consume the exported global provider instead of constructing
 * a separate pool per module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
