import { Controller, Get } from '@nestjs/common';
import { SUBSCRIPTION_PLANS, COIN_PACKS } from './plans.config';

@Controller('plans')
export class PlansController {
  @Get()
  getPlans() {
    return {
      subscriptions: SUBSCRIPTION_PLANS,
      coins: COIN_PACKS,
    };
  }
}

