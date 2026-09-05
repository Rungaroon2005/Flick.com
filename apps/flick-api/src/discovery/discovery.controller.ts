import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';
import { DiscoveryService } from './discovery.service';
import { FitsQueryDto } from './dto/fits-query.dto';

/**
 * Deliberately NOT @Public() and NOT folded into a /movies query param.
 * `kind: 'next_episode'` is personal -- it differs per caller -- and
 * /movies is a single cache slot shared by every caller regardless of
 * auth state. Putting a personalized branch inside that handler would be
 * one refactor away from someone caching it. The global JwtAuthGuard
 * protects this route by default.
 */
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  // transform: true is opted into locally rather than globally (main.ts's
  // ValidationPipe does not set it): a query string arrives as text, and
  // FitsQueryDto's @IsIn(ALLOWED_MAX_MINUTES) needs the @Transform'd
  // number, not "30", to ever match.
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @Get('fits')
  fits(@CurrentUser() user: AuthenticatedUser, @Query() query: FitsQueryDto) {
    return this.discovery.fits(user.id, query.maxMinutes);
  }
}
