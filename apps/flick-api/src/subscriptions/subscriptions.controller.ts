import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
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
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subscriptionsService.create(user.id, dto.planId);
  }

  @Delete('me')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.cancel(user.id);
  }
}
