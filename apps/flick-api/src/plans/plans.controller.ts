import { Controller, Get } from '@nestjs/common';
import { SUBSCRIPTION_PLANS } from './plans.config';
import { Public } from '../auth/public.decorator';

@Controller('plans')
export class PlansController {
  @Public()
  @Get()
  getPlans() {
    return {
      subscriptions: SUBSCRIPTION_PLANS,
    };
  }
}
