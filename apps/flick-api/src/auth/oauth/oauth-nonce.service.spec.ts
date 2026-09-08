import { BadRequestException } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { OAuthNonceService } from './oauth-nonce.service';
import { PrismaService } from '../../prisma.service';
import { createPrismaMock } from '../../testing/prisma.mock';

describe('OAuthNonceService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: OAuthNonceService;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.oAuthNonce.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'on_1', ...args.data }),
    );
    service = new OAuthNonceService(prisma as unknown as PrismaService);
  });

  const live = (overrides = {}) => ({
    id: 'on_1',
    nonce: 'n_1',
    provider: IdentityProvider.GOOGLE,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    ...overrides,
  });

  it('issues an unguessable nonce and stores it against the provider', async () => {
    const issued = await service.issue(IdentityProvider.APPLE);

    expect(issued.nonce.length).toBeGreaterThanOrEqual(32);
    expect(issued.expiresIn).toBeGreaterThan(0);

    const created = prisma.oAuthNonce.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.provider).toBe(IdentityProvider.APPLE);
    expect(created.data.nonce).toBe(issued.nonce);
  });

  it('consumes a live nonce exactly once', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(live());
    prisma.oAuthNonce.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).resolves.toBeUndefined();
  });

  it('rejects a replay whose consuming update matches zero rows', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(live());
    // A concurrent request burned it between our read and our write.
    prisma.oAuthNonce.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an already-consumed nonce without touching the row', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(
      live({ consumedAt: new Date() }),
    );

    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.oAuthNonce.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an expired nonce', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(
      live({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a nonce issued for a different provider', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(
      live({ provider: IdentityProvider.APPLE }),
    );

    // Otherwise an Apple nonce could be spent on a Google token.
    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown nonce', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(null);

    await expect(
      service.consume('nope', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });
});
