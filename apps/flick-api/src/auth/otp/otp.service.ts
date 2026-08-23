import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { maskDestination, normalizeDestination } from './destination';
import {
  compareOtpCode,
  generateOtpCode,
  generateOtpRef,
  hashOtpCode,
  timingSafeEqualString,
} from './otp-code';
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from './otp-delivery.port';
import {
  DEFAULT_OTP_GLOBAL_DAILY_CAP,
  OTP_COOLDOWN_MS,
  OTP_LONG_WINDOW_MAX,
  OTP_LONG_WINDOW_MS,
  OTP_MAX_ATTEMPTS,
  OTP_SHORT_WINDOW_MAX,
  OTP_SHORT_WINDOW_MS,
  OTP_TTL_MS,
} from './otp.config';

export interface OtpRequestResult {
  ref: string;
  expiresIn: number;
}

export interface OtpRequestInput {
  destination: string;
  channel: OtpChannel;
  ipAddress: string;
}

export interface OtpVerifyResult {
  userId: string;
  isNewUser: boolean;
}

export interface OtpVerifyInput {
  destination: string;
  channel: OtpChannel;
  ref: string;
  code: string;
}

/**
 * Deliberately identical for every rate-limit trip. Distinguishing "you are in
 * cooldown" from "this destination is capped" would tell an attacker whether
 * someone else has been requesting codes for that number.
 */
const RATE_LIMITED =
  'ขอรหัสบ่อยเกินไป กรุณารอสักครู่ (Too many requests, please wait)';

/** One message for every failure mode: unknown, expired, wrong ref, wrong code,
 *  already consumed. Anything more specific is an oracle. */
const INVALID_CODE = 'รหัสไม่ถูกต้องหรือหมดอายุ (Invalid or expired code)';
const ATTEMPTS_EXHAUSTED =
  'ใส่รหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่ (Too many attempts, request a new code)';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly globalDailyCap: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
    config: ConfigService,
  ) {
    this.globalDailyCap =
      Number(config.get<string | number>('OTP_GLOBAL_DAILY_CAP')) ||
      DEFAULT_OTP_GLOBAL_DAILY_CAP;
  }

  async request({
    destination,
    channel,
    ipAddress,
  }: OtpRequestInput): Promise<OtpRequestResult> {
    const normalized = normalizeDestination(destination, channel);
    const now = new Date();

    // An email may only receive a login code if it is ALREADY verified on an
    // account. Allowing a free-text address would let anyone request a code
    // for someone else's account and have it delivered to themselves.
    // SMS needs no such check: the phone IS the identity, and delivery to a
    // number the requester does not control reveals nothing to them.
    const deliverable =
      channel === OtpChannel.SMS ||
      (await this.prisma.user.findFirst({
        where: { email: normalized, isVerified: true, deletedAt: null },
        select: { id: true },
      })) !== null;

    await this.enforceRateLimits(normalized, now);

    // Supersede any live code for this destination before issuing a new one.
    await this.prisma.otpChallenge.updateMany({
      where: {
        destination: normalized,
        purpose: OtpPurpose.LOGIN,
        consumedAt: null,
      },
      data: { consumedAt: now },
    });

    const code = generateOtpCode();
    const ref = generateOtpRef();

    await this.prisma.otpChallenge.create({
      data: {
        channel,
        destination: normalized,
        codeHash: await hashOtpCode(code),
        ref,
        purpose: OtpPurpose.LOGIN,
        ipAddress,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
    });

    if (deliverable) {
      try {
        await this.delivery.send(normalized, channel, code, ref);
      } catch (err) {
        // The challenge row survives, but no code was ever delivered, so it is
        // unusable. The cooldown still applies, which is what we want.
        this.logger.error(
          `OTP delivery failed for ${maskDestination(normalized)}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
        throw new ServiceUnavailableException(
          'ไม่สามารถส่งรหัสยืนยันได้ กรุณาลองใหม่ภายหลัง (Could not send code)',
        );
      }
    }

    // Identical shape on every path — this is what makes account enumeration
    // through this endpoint impossible.
    return { ref, expiresIn: Math.floor(OTP_TTL_MS / 1000) };
  }

  /**
   * All four limits are derived from OtpChallenge rows, so they can never
   * disagree with what was actually issued. Counting is cheap: every query
   * here is served by @@index([destination, createdAt]).
   */
  private async enforceRateLimits(
    destination: string,
    now: Date,
  ): Promise<void> {
    const since = (ms: number) => new Date(now.getTime() - ms);

    const [inCooldown, inShortWindow, inLongWindow, globalToday] =
      await Promise.all([
        this.prisma.otpChallenge.count({
          where: { destination, createdAt: { gt: since(OTP_COOLDOWN_MS) } },
        }),
        this.prisma.otpChallenge.count({
          where: { destination, createdAt: { gt: since(OTP_SHORT_WINDOW_MS) } },
        }),
        this.prisma.otpChallenge.count({
          where: { destination, createdAt: { gt: since(OTP_LONG_WINDOW_MS) } },
        }),
        this.prisma.otpChallenge.count({
          where: { createdAt: { gt: since(OTP_LONG_WINDOW_MS) } },
        }),
      ]);

    if (globalToday >= this.globalDailyCap) {
      // Per-destination limits cannot see an attacker spraying thousands of
      // distinct numbers. Every send costs money, so this is a billing attack
      // and deserves an alert, not just a 429.
      this.logger.error(
        `OTP global daily cap reached (${globalToday}/${this.globalDailyCap}) — possible SMS-pumping attack`,
      );
      throw new HttpException(RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (
      inCooldown > 0 ||
      inShortWindow >= OTP_SHORT_WINDOW_MAX ||
      inLongWindow >= OTP_LONG_WINDOW_MAX
    ) {
      throw new HttpException(RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * Verifies a code and resolves the caller to a user, creating one on first
   * success (lazy registration). Runs in one transaction so consumption and
   * user creation cannot come apart.
   */
  async verify({
    destination,
    channel,
    ref,
    code,
  }: OtpVerifyInput): Promise<OtpVerifyResult> {
    const normalized = normalizeDestination(destination, channel);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.otpChallenge.findFirst({
        where: {
          destination: normalized,
          purpose: OtpPurpose.LOGIN,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!challenge) throw new UnauthorizedException(INVALID_CODE);

      // Both comparisons run before either is branched on, so "wrong ref" and
      // "wrong code" cost the same time and are indistinguishable to a caller.
      const refMatches = timingSafeEqualString(challenge.ref, ref);
      const codeMatches = await compareOtpCode(code, challenge.codeHash);

      if (!refMatches || !codeMatches) {
        const attempts = challenge.attempts + 1;
        const exhausted = attempts >= OTP_MAX_ATTEMPTS;
        await tx.otpChallenge.updateMany({
          // Guarding on the observed `attempts` makes this an optimistic
          // update: a concurrent wrong guess that already incremented the
          // counter causes this one to match zero rows rather than
          // overwriting it with a stale value and granting a free attempt.
          where: {
            id: challenge.id,
            consumedAt: null,
            attempts: challenge.attempts,
          },
          data: { attempts, ...(exhausted ? { consumedAt: now } : {}) },
        });
        if (exhausted) {
          throw new HttpException(
            ATTEMPTS_EXHAUSTED,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        throw new UnauthorizedException(INVALID_CODE);
      }

      // The `consumedAt: null` guard is the single-use mechanism. Two
      // simultaneous correct submissions both reach here; the second matches
      // zero rows once the first commits.
      const consumed = await tx.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count === 0) throw new UnauthorizedException(INVALID_CODE);

      const identity =
        channel === OtpChannel.SMS
          ? { phone: normalized }
          : { email: normalized };

      const existing = await tx.user.findFirst({
        where: { ...identity, deletedAt: null },
        select: { id: true },
      });

      const user =
        existing ??
        (await tx.user.create({
          data: {
            ...identity,
            displayName: placeholderDisplayName(normalized, channel),
            // They just proved control of the destination.
            isVerified: true,
            // passwordHash intentionally omitted — passwordless.
          },
          select: { id: true },
        }));

      await tx.otpChallenge.updateMany({
        where: { id: challenge.id },
        data: { userId: user.id },
      });

      return { userId: user.id, isNewUser: existing === null };
    });
  }
}

/** A non-empty display name for a lazily-created user. Editable later. */
function placeholderDisplayName(
  destination: string,
  channel: OtpChannel,
): string {
  if (channel === OtpChannel.EMAIL) return destination.split('@')[0];
  return `ผู้ใช้${destination.slice(-4)}`;
}
