import {
  OAUTH_NONCE_RETENTION_MS,
  OTP_CHALLENGE_RETENTION_MS,
  PruneService,
} from './prune.service';
import { OTP_LONG_WINDOW_MS } from '../auth/otp/otp.config';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('PruneService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: PruneService;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.oAuthNonce.deleteMany.mockResolvedValue({ count: 3 });
    prisma.otpChallenge.deleteMany.mockResolvedValue({ count: 7 });
    service = new PruneService(prisma as unknown as PrismaService);
  });

  it('keeps OTP challenges longer than the rate limiter counts them', () => {
    // enforceRateLimits COUNTS OtpChallenge rows over OTP_LONG_WINDOW_MS.
    // Deleting inside that window would weaken the abuse control silently.
    // Asserted as a relationship so a future trim cannot cross the floor.
    expect(OTP_CHALLENGE_RETENTION_MS).toBeGreaterThan(OTP_LONG_WINDOW_MS);
  });

  it('deletes only rows past their retention', async () => {
    const before = Date.now();
    await service.pruneExpired();

    // Cast the whole calls array, not one element: mock.calls is any[], so
    // indexing into it first is what trips no-unsafe-member-access.
    const calls = prisma.otpChallenge.deleteMany.mock.calls as [
      { where: { expiresAt: { lt: Date } } },
    ][];
    const cutoff = calls[0][0].where.expiresAt.lt.getTime();
    expect(cutoff).toBeLessThanOrEqual(
      before - OTP_CHALLENGE_RETENTION_MS + 1000,
    );
    expect(cutoff).toBeGreaterThan(before - OTP_CHALLENGE_RETENTION_MS - 5000);
  });

  it('reports what it removed', async () => {
    await expect(service.pruneExpired()).resolves.toEqual({
      oauthNonces: 3,
      otpChallenges: 7,
    });
  });

  it('prunes nonces on their own, shorter retention', async () => {
    await service.pruneExpired();

    expect(OAUTH_NONCE_RETENTION_MS).toBeLessThan(OTP_CHALLENGE_RETENTION_MS);
    expect(prisma.oAuthNonce.deleteMany).toHaveBeenCalled();
  });
});
