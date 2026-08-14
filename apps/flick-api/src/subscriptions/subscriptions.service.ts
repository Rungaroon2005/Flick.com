import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PLAN_DURATIONS_MS, PaidPlanId } from '../plans/plans.config';

type Tx = Prisma.TransactionClient;

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Locks the user's row for the remainder of the enclosing transaction via
   * `SELECT ... FOR UPDATE`.
   *
   * This is load-bearing, not decorative — see `WalletService.lockUserRow`
   * for the full rationale. Wrapping a check-then-create in `$transaction`
   * alone does NOT prevent two concurrent `create()` calls for the same
   * user from both seeing "no active subscription" and both inserting one:
   * Postgres's default READ COMMITTED isolation does not serialize a plain
   * check-then-act sequence across concurrent transactions. `FOR UPDATE`
   * closes that gap: the second concurrent transaction blocks on this
   * SELECT until the first commits (or rolls back), then observes the
   * first transaction's already-created subscription.
   */
  private async lockUserRow(
    tx: Tx,
    userId: string,
  ): Promise<{ id: string } | null> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Creates an ACTIVE subscription for `userId` on `planId`.
   *
   * `startDate`/`endDate` are computed server-side ONLY, from
   * `PLAN_DURATIONS_MS` — never trusted from the client. This is what fixes
   * the ฿49-buys-30-days bug: `PLAN_DURATIONS_MS` is the single source of
   * truth for both the DTO's validation and the duration math, so a
   * mismatched id can no longer silently fall through to the wrong plan's
   * duration (it's rejected before this method is even called).
   *
   * The user row lock (`lockUserRow`) is acquired FIRST, then the active-
   * subscription check, then the create — all inside one `$transaction` —
   * so two concurrent calls for the same user cannot both create an ACTIVE
   * subscription. See `lockUserRow`'s doc comment for why this ordering
   * matters.
   *
   * No payment gateway is wired yet: `paymentMethod` is the explicit
   * placeholder `'none'` and `gatewaySubscriptionId` stays `null` (it's
   * `@unique`, so a placeholder string would collide on the second write).
   */
  async create(userId: string, planId: PaidPlanId) {
    if (!(planId in PLAN_DURATIONS_MS)) {
      throw new BadRequestException(`Invalid plan id: ${String(planId)}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await this.lockUserRow(tx, userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      const existingActive = await tx.subscription.findFirst({
        where: {
          userId,
          status: SubscriptionStatus.ACTIVE,
          endDate: { gt: new Date() },
        },
        select: { id: true },
      });
      if (existingActive) {
        throw new ConflictException('User already has an active subscription');
      }

      const now = new Date();
      // TODO: create PaymentEvent on gateway callback
      return tx.subscription.create({
        data: {
          userId,
          planType: planId,
          status: SubscriptionStatus.ACTIVE,
          startDate: now,
          endDate: new Date(now.getTime() + PLAN_DURATIONS_MS[planId]),
          paymentMethod: 'none',
          autoRenew: true,
        },
      });
    });
  }

  /**
   * The user's current active subscription, or `null`. A subscription is
   * "active" only while `endDate > now` — there is no background job that
   * flips `status` to `EXPIRED`; expiry is evaluated at read time.
   */
  async findActive(userId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endDate: { gt: new Date() },
      },
      orderBy: { endDate: 'desc' },
    });
  }

  /**
   * Cancels the user's active subscription: sets `status: CANCELED` and
   * `autoRenew: false`. Does NOT touch `endDate` — access remains valid
   * through the already-paid-for period per `findActive`'s `endDate > now`
   * check; only future auto-renewal is stopped.
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
        status: SubscriptionStatus.ACTIVE,
        endDate: { gt: new Date() },
      },
      select: { id: true },
    });
    return active !== null;
  }
}
