import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { maskDestination, normalizeDestination } from './destination';
import { generateOtpCode, generateOtpRef, hashOtpCode } from './otp-code';
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from './otp-delivery.port';
import {
  DEFAULT_OTP_GLOBAL_DAILY_CAP,
  OTP_COOLDOWN_MS,
  OTP_LONG_WINDOW_MAX,
  OTP_LONG_WINDOW_MS,
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

/**
 * Deliberately identical for every rate-limit trip. Distinguishing "you are in
 * cooldown" from "this destination is capped" would tell an attacker whether
 * someone else has been requesting codes for that number.
 */
const RATE_LIMITED =
  'ขอรหัสบ่อยเกินไป กรุณารอสักครู่ (Too many requests, please wait)';

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
}
