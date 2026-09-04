import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';

/** Nothing reads a nonce a day after it expired. */
export const OAUTH_NONCE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * 7 days. These rows carry ipAddress, so the period is a privacy decision under
 * PDPA, not an engineering one — long enough for debugging and abuse
 * mitigation, short enough to keep the footprint small.
 *
 * FLOOR: must stay well above OTP_LONG_WINDOW_MS (24h). enforceRateLimits
 * derives all four OTP limits by COUNTING these rows over that window, so
 * deleting inside it would quietly weaken the abuse control with nothing in the
 * logs to show for it. prune.service.spec asserts the relationship.
 */
export const OTP_CHALLENGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class PruneService {
  private readonly logger = new Logger(PruneService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent, so running on every instance is harmless — no leader election. */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const removed = await this.pruneExpired();
    if (removed.oauthNonces > 0 || removed.otpChallenges > 0) {
      this.logger.log(
        `Pruned ${removed.oauthNonces} oauth nonces, ${removed.otpChallenges} otp challenges`,
      );
    }
  }

  async pruneExpired(): Promise<{
    oauthNonces: number;
    otpChallenges: number;
  }> {
    const now = Date.now();

    const [oauthNonces, otpChallenges] = await Promise.all([
      this.prisma.oAuthNonce.deleteMany({
        where: { expiresAt: { lt: new Date(now - OAUTH_NONCE_RETENTION_MS) } },
      }),
      this.prisma.otpChallenge.deleteMany({
        where: {
          expiresAt: { lt: new Date(now - OTP_CHALLENGE_RETENTION_MS) },
        },
      }),
    ]);

    return {
      oauthNonces: oauthNonces.count,
      otpChallenges: otpChallenges.count,
    };
  }
}
