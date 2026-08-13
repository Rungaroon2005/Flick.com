import { IsIn } from 'class-validator';
import { PLAN_DURATIONS_MS } from '../../plans/plans.config';
import type { PaidPlanId } from '../../plans/plans.config';

/**
 * Validates `planId` against `PLAN_DURATIONS_MS`'s own keys — the single
 * source of truth for valid paid plan ids. A legacy/typo'd id like
 * `'vip-weekly'` is rejected with a 400 here rather than reaching the
 * service and silently falling back to another plan's duration.
 */
export class CreateSubscriptionDto {
  @IsIn(Object.keys(PLAN_DURATIONS_MS))
  planId!: PaidPlanId;
}
