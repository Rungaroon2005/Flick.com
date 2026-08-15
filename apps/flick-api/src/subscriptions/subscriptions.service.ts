import { BadRequestException, Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';

const ENTITLED_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.CANCELED,
];

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The user's current entitled subscription, or `null`. Canceling turns off
   * renewal but preserves access through `endDate`, so both ACTIVE and
   * CANCELED records are entitled until they expire.
   */
  async findActive(userId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ENTITLED_STATUSES },
        endDate: { gt: new Date() },
      },
      orderBy: { endDate: 'desc' },
    });
  }

  /**
   * Cancels renewal without forfeiting the already-paid-for period. The
   * CANCELED status remains entitled through `endDate` in `findActive` and
   * `hasActiveSubscription`.
   */
  async cancel(userId: string) {
    const active = await this.findActive(userId);
    if (!active) {
      throw new BadRequestException('No active subscription to cancel');
    }
    return this.prisma.subscription.update({
      where: { id: active.id },
      data: { status: SubscriptionStatus.CANCELED, autoRenew: false },
    });
  }

  /**
   * Has this user got a currently-active subscription? Consumed by Task
   * 2.5. A point-in-time, non-transactional read — fine for gating access
   * checks. Uses the existing `@@index([userId, status])`.
   */
  async hasActiveSubscription(userId: string): Promise<boolean> {
    const active = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ENTITLED_STATUSES },
        endDate: { gt: new Date() },
      },
      select: { id: true },
    });
    return active !== null;
  }
}
