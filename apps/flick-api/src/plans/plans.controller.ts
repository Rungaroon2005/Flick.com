import { Controller, Get } from '@nestjs/common';
import { SUBSCRIPTION_PLANS, COIN_PACKS } from './plans.config';
import { Public } from '../auth/public.decorator';

@Controller('plans')
export class PlansController {
  @Public()
  @Get()
  getPlans() {
    return {
      subscriptions: SUBSCRIPTION_PLANS,
      coins: COIN_PACKS,
    };
  }
}
