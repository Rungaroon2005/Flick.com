import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';
import { PrismaService } from './prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  async getHealth() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'up' };
  }
}
