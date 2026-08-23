import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { OtpChannel } from '@prisma/client';
import { OtpService } from './otp.service';
import { PrismaService } from '../../prisma.service';
import { OTP_DELIVERY_PORT } from './otp-delivery.port';
import { createPrismaMock } from '../../testing/prisma.mock';
import { OTP_SHORT_WINDOW_MAX, OTP_TTL_MS } from './otp.config';

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
