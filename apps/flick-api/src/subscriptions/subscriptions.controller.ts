import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.findActive(user.id);
  }

  @Post()
  create(): never {
    // Paid access must only be activated by a verified, idempotent payment
    // callback. Until a gateway exists, fail closed instead of minting an
    // ACTIVE subscription directly from a browser request.
    throw new ServiceUnavailableException(
      'ยังไม่เปิดให้ชำระเงินในขณะนี้ (Payments are not available yet)',
    );
  }

  @Delete('me')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.cancel(user.id);
  }
}
