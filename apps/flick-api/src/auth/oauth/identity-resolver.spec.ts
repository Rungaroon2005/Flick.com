import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { IdentityProvider, Prisma } from '@prisma/client';
import { IdentityResolver } from './identity-resolver';
import { PrismaService } from '../../prisma.service';
import { createPrismaMock } from '../../testing/prisma.mock';
import type { ProviderProfile } from './oauth-provider.port';

describe('IdentityResolver', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let resolver: IdentityResolver;

  const profile = (
    overrides: Partial<ProviderProfile> = {},
  ): ProviderProfile => ({
    providerAccountId: 'sub_1',
    email: 'a@example.com',
    emailVerified: true,
    displayName: 'Somchai',
    avatarUrl: null,
    ...overrides,
  });

  const resolve = (p: ProviderProfile = profile()) =>
    resolver.resolve(IdentityProvider.GOOGLE, p);

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.user.create.mockResolvedValue({ id: 'u_new' });
    prisma.identity.create.mockResolvedValue({ id: 'i_1' });
    resolver = new IdentityResolver(prisma as unknown as PrismaService);
  });

  it('logs in a returning user by provider account id', async () => {
    prisma.identity.findUnique.mockResolvedValue({
      id: 'i_1',
      userId: 'u1',
      user: { id: 'u1', deletedAt: null },
    });

    await expect(resolve()).resolves.toEqual({
      userId: 'u1',
      isNewUser: false,
      linked: false,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses a returning user whose account was deleted', async () => {
    prisma.identity.findUnique.mockResolvedValue({
      id: 'i_1',
      userId: 'u1',
      user: { id: 'u1', deletedAt: new Date() },
    });

    await expect(resolve()).rejects.toThrow(UnauthorizedException);
  });

  // --- spec §6.2, row by row -------------------------------------------

  it('row 1: creates an emailless user when the provider gives no email', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);

    await expect(resolve(profile({ email: null }))).resolves.toMatchObject({
      isNewUser: true,
    });

    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.email).toBeNull();
    expect(created.data.emailVerifiedAt).toBeNull();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('row 2: NEVER links on an unverified provider email', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);

    // The takeover: an attacker registers the victim's address at a provider
    // that does not verify it. We must not even look for a matching user.
    await expect(
      resolve(profile({ emailVerified: false })),
    ).resolves.toMatchObject({ isNewUser: true, linked: false });

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.email).toBeNull();
  });

  it('row 3: creates a verified-email user when no account matches', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(resolve()).resolves.toMatchObject({ isNewUser: true });

    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.email).toBe('a@example.com');
    expect(created.data.emailVerifiedAt).toEqual(expect.any(Date));
  });

  it('row 4: auto-links a verified provider email to a verified local account', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u_existing',
      emailVerifiedAt: new Date('2026-01-01'),
    });

    await expect(resolve()).resolves.toEqual({
      userId: 'u_existing',
      isNewUser: false,
      linked: true,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();

    const identity = prisma.identity.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(identity.data.userId).toBe('u_existing');
    expect(identity.data.providerAccountId).toBe('sub_1');
  });

  it('row 5: refuses to link to an account whose email was never proven', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u_unproven',
      emailVerifiedAt: null,
    });

    // Pre-hijacking: someone claimed this address locally without proving it.
    // Linking would log the real owner into the squatter's account.
    await expect(resolve()).rejects.toThrow(ConflictException);
    expect(prisma.identity.create).not.toHaveBeenCalled();
  });

  it('falls back to a display name when the provider gives none', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);

    await resolve(profile({ displayName: null }));

    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.displayName).toEqual(expect.any(String));
    expect(String(created.data.displayName).length).toBeGreaterThan(0);
  });

  it('records what the provider asserted, for audit', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);

    await resolve();

    const identity = prisma.identity.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(identity.data.email).toBe('a@example.com');
    expect(identity.data.emailVerified).toBe(true);
    expect(identity.data.provider).toBe(IdentityProvider.GOOGLE);
  });

  // --- spec §7, concurrency ---------------------------------------------

  const uniqueViolation = (target: string[]) =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target },
    });

  it('treats a concurrent first verification as a login, not an error', async () => {
    // Both requests read "no identity"; the other one won the insert.
    prisma.identity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'i_1',
        userId: 'u_winner',
        user: { id: 'u_winner', deletedAt: null },
      });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValueOnce(
      uniqueViolation(['provider', 'providerAccountId']),
    );

    await expect(resolve()).resolves.toEqual({
      userId: 'u_winner',
      isNewUser: false,
      linked: false,
    });
  });

  it('rethrows a unique violation on a different constraint', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    // Two people, one email. Swallowing this as a "concurrent login" would
    // resolve to whatever identity happened to exist.
    prisma.$transaction.mockRejectedValueOnce(uniqueViolation(['email']));

    await expect(resolve()).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('does not loop forever if the winner cannot be found', async () => {
    prisma.identity.findUnique.mockResolvedValue(null); // never appears
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(
      uniqueViolation(['provider', 'providerAccountId']),
    );

    await expect(resolve()).rejects.toThrow();
  });
});
