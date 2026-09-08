import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';
import { PassportService } from './passport.service';

/**
 * Personal, never @Public(): every field is specific to the caller, and
 * /movies-style shared caching would leak one user's watch history into
 * another's response (design doc §2.1).
 */
@Controller('me')
export class PassportController {
  constructor(private readonly passport: PassportService) {}

  @Get('passport')
  getPassport(@CurrentUser() user: AuthenticatedUser) {
    return this.passport.getPassport(user.id);
  }
}
