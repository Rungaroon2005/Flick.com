import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { OtpChannel } from '@prisma/client';
import { OtpService } from './otp.service';
import { PrismaService } from '../../prisma.service';
import { OTP_DELIVERY_PORT } from './otp-delivery.port';
import { createPrismaMock } from '../../testing/prisma.mock';
import * as otpCode from './otp-code';
import {
  OTP_MAX_ATTEMPTS,
  OTP_SHORT_WINDOW_MAX,
  OTP_TTL_MS,
} from './otp.config';

describe('OtpService.request', () => {
  let service: OtpService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let delivery: { send: jest.Mock };

  const noRateLimitHits = () => prisma.otpChallenge.count.mockResolvedValue(0);

  beforeEach(async () => {
    prisma = createPrismaMock();
    delivery = { send: jest.fn().mockResolvedValue(undefined) };
    prisma.otpChallenge.create.mockResolvedValue({ id: 'c1' });
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OTP_DELIVERY_PORT, useValue: delivery },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    service = module.get(OtpService);
  });

  it('normalizes the destination before storing or delivering it', async () => {
    noRateLimitHits();
    await service.request({
      destination: '081-234-5678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });

    const created = prisma.otpChallenge.create.mock.calls[0][0] as {
      data: { destination: string };
    };
    expect(created.data.destination).toBe('+66812345678');
    expect(delivery.send.mock.calls[0][0]).toBe('+66812345678');
  });

  it('never persists the plaintext code', async () => {
    noRateLimitHits();
    await service.request({
      destination: '+66812345678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });

    const created = prisma.otpChallenge.create.mock.calls[0][0] as {
      data: { codeHash: string };
    };
    const deliveredCode = delivery.send.mock.calls[0][2] as string;
    expect(created.data.codeHash).not.toBe(deliveredCode);
    expect(created.data.codeHash).not.toContain(deliveredCode);
  });

  it('invalidates any earlier live challenge for the destination', async () => {
    // A code left sitting in an SMS thread must stop working the moment a new
    // one is issued.
    noRateLimitHits();
    await service.request({
      destination: '+66812345678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });

    expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          destination: '+66812345678',
          consumedAt: null,
        }),
      }),
    );
  });

  it('returns the same shape for an unknown destination as a known one', async () => {
    noRateLimitHits();
    const result = await service.request({
      destination: '+66812345678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });

    expect(result).toEqual({
      ref: expect.stringMatching(/^[A-Z2-9]{4}$/) as unknown as string,
      expiresIn: OTP_TTL_MS / 1000,
    });
    expect(Object.keys(result).sort()).toEqual(['expiresIn', 'ref']);
  });

  it('rejects a second request inside the cooldown window', async () => {
    // First count() call is the 60s cooldown bucket.
    prisma.otpChallenge.count.mockResolvedValue(1);

    await expect(
      service.request({
        destination: '+66812345678',
        channel: OtpChannel.SMS,
        ipAddress: '1.2.3.4',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(delivery.send).not.toHaveBeenCalled();
  });

  it('rejects once the 15-minute destination cap is reached', async () => {
    prisma.otpChallenge.count
      .mockResolvedValueOnce(0) // cooldown
      .mockResolvedValueOnce(OTP_SHORT_WINDOW_MAX) // 15 min
      .mockResolvedValueOnce(0) // 24h
      .mockResolvedValueOnce(0); // global

    await expect(
      service.request({
        destination: '+66812345678',
        channel: OtpChannel.SMS,
        ipAddress: '1.2.3.4',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('does not email a code to an address not verified on an account', async () => {
    noRateLimitHits();
    prisma.user.findFirst.mockResolvedValue(null);

    const result = await service.request({
      destination: 'victim@example.com',
      channel: OtpChannel.EMAIL,
      ipAddress: '1.2.3.4',
    });

    // Nothing delivered — but the response is indistinguishable from success,
    // and the row still exists so the attempt counts against the rate limit.
    expect(delivery.send).not.toHaveBeenCalled();
    expect(prisma.otpChallenge.create).toHaveBeenCalled();
    expect(result.expiresIn).toBe(OTP_TTL_MS / 1000);
  });

  it('emails a code when the address is verified on an account', async () => {
    noRateLimitHits();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await service.request({
      destination: 'owner@example.com',
      channel: OtpChannel.EMAIL,
      ipAddress: '1.2.3.4',
    });

    expect(delivery.send).toHaveBeenCalled();
  });

  it('does not make the email response wait on the vendor', async () => {
    noRateLimitHits();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' }); // a deliverable address
    let releaseVendor: () => void = () => undefined;
    delivery.send.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseVendor = resolve;
      }),
    );

    // Resolves while the vendor call is still outstanding. A caller cannot
    // time "we sent it" against "we did not" if the send is never awaited.
    await expect(
      service.request({
        destination: 'owner@example.com',
        channel: OtpChannel.EMAIL,
        ipAddress: '1.2.3.4',
      }),
    ).resolves.toMatchObject({ ref: expect.any(String) });

    releaseVendor();
  });

  it('does not turn an email vendor outage into an account oracle', async () => {
    noRateLimitHits();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    delivery.send.mockRejectedValue(new Error('email vendor down'));

    // A 503 that can only ever fire for an address that has an account is an
    // oracle. The failure is logged, never returned.
    await expect(
      service.request({
        destination: 'owner@example.com',
        channel: OtpChannel.EMAIL,
        ipAddress: '1.2.3.4',
      }),
    ).resolves.toMatchObject({ ref: expect.any(String) });
  });

  it('surfaces a delivery failure as 503 without leaking the code', async () => {
    noRateLimitHits();
    delivery.send.mockRejectedValue(new Error('sms vendor down'));

    await expect(
      service.request({
        destination: '+66812345678',
        channel: OtpChannel.SMS,
        ipAddress: '1.2.3.4',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('OtpService.verify', () => {
  let service: OtpService;
  let prisma: ReturnType<typeof createPrismaMock>;

  // A live challenge whose code is '123456'. Hashed at cost 4 to keep the
  // suite fast — production uses OTP_BCRYPT_ROUNDS.
  const liveChallenge = async (overrides = {}) => ({
    id: 'c1',
    channel: OtpChannel.SMS,
    destination: '+66812345678',
    codeHash: await bcrypt.hash('123456', 4),
    ref: 'AB2C',
    purpose: 'LOGIN',
    attempts: 0,
    userId: null,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OTP_DELIVERY_PORT, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    service = module.get(OtpService);
  });

  const verify = (code = '123456', ref = 'AB2C') =>
    service.verify({
      destination: '0812345678',
      channel: OtpChannel.SMS,
      ref,
      code,
    });

  it('logs in an existing user and reports isNewUser false', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await expect(verify()).resolves.toEqual({
      userId: 'u1',
      isNewUser: false,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('lazily creates a passwordless user on first verify', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u-new' });

    await expect(verify()).resolves.toEqual({
      userId: 'u-new',
      isNewUser: true,
    });

    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.phone).toBe('+66812345678');
    expect(created.data.isVerified).toBe(true);
    expect(created.data.passwordHash).toBeUndefined();
  });

  it('consumes the challenge with a guard on consumedAt: null', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await verify();

    expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', consumedAt: null },
        data: expect.objectContaining({
          consumedAt: expect.any(Date) as unknown as Date,
        }),
      }),
    );
  });

  it('rejects a replay whose consuming update matches zero rows', async () => {
    // Exactly what a concurrent second correct submission sees.
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

    await expect(verify()).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown or expired challenge generically', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(null);
    await expect(verify()).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a wrong ref even when the code is right', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    await expect(verify('123456', 'ZZZZ')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('increments attempts on a wrong code without consuming the challenge', async () => {
    // First findFirst call is the initial challenge lookup; the second is
    // the read-back of the post-increment row.
    prisma.otpChallenge.findFirst
      .mockResolvedValueOnce(await liveChallenge())
      .mockResolvedValueOnce({ attempts: 1, consumedAt: null });

    await expect(verify('000000')).rejects.toThrow(UnauthorizedException);

    const call = prisma.otpChallenge.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // Atomic DB-level increment — the form Postgres's READ COMMITTED
    // first-updater-wins re-check actually protects, unlike a precomputed
    // literal. Every concurrent wrong guess counts exactly once.
    expect(call.data).toEqual({ attempts: { increment: 1 } });
    // The single-use guard: an already-consumed challenge is never
    // incremented.
    expect(call.where).toEqual({ id: 'c1', consumedAt: null });
  });

  it('rejects a wrong-guess race loser whose increment matches zero rows', async () => {
    // Exactly what a concurrent wrong guess sees once a correct submission
    // has already consumed the challenge: nothing left to increment against.
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

    await expect(verify('000000')).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('still runs the bcrypt comparison when the ref is already known wrong', async () => {
    // Pins the timing-safety property: both comparisons must run before
    // either is branched on. A future edit that short-circuits on
    // `!refMatches` before comparing the code would reintroduce the
    // ref-vs-code timing oracle, and this test would catch it.
    const compareSpy = jest.spyOn(otpCode, 'compareOtpCode');
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());

    await expect(verify('123456', 'ZZZZ')).rejects.toThrow(
      UnauthorizedException,
    );

    expect(compareSpy).toHaveBeenCalledWith(
      '123456',
      expect.any(String) as unknown as string,
    );
    compareSpy.mockRestore();
  });

  it('burns the challenge and returns 429 on the final wrong attempt', async () => {
    prisma.otpChallenge.findFirst
      .mockResolvedValueOnce(
        await liveChallenge({ attempts: OTP_MAX_ATTEMPTS - 1 }),
      )
      .mockResolvedValueOnce({
        attempts: OTP_MAX_ATTEMPTS,
        consumedAt: null,
      });

    await expect(verify('000000')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    // First updateMany call is the atomic increment; second is the burn.
    const incrementCall = prisma.otpChallenge.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(incrementCall.data).toEqual({ attempts: { increment: 1 } });

    const burnCall = prisma.otpChallenge.updateMany.mock.calls[1][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(burnCall.where).toEqual({ id: 'c1', consumedAt: null });
    expect(burnCall.data.consumedAt).toEqual(expect.any(Date));
  });

  it('refuses a burned challenge even with the correct code', async () => {
    // The challenge is consumed, so findFirst (which filters consumedAt: null)
    // returns nothing — the right code is now worthless.
    prisma.otpChallenge.findFirst.mockResolvedValue(null);
    await expect(verify('123456')).rejects.toThrow(UnauthorizedException);
  });
});
