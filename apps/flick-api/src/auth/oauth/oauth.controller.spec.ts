import { ConflictException, NotFoundException } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { OAuthController } from './oauth.controller';
import { FakeOAuthProviderAdapter } from './adapters/fake-provider.adapter';
import type { OAuthProviderRegistry } from './oauth-provider.port';

describe('OAuthController', () => {
  let controller: OAuthController;
  let nonces: { issue: jest.Mock; consume: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let jwt: { signAsync: jest.Mock };
  let users: { findById: jest.Mock };
  let res: { cookie: jest.Mock };

  const registry: OAuthProviderRegistry = new Map([
    [
      IdentityProvider.GOOGLE,
      new FakeOAuthProviderAdapter(IdentityProvider.GOOGLE),
    ],
  ]);

  const profile = {
    providerAccountId: 'sub_1',
    email: 'a@example.com',
    emailVerified: true,
    displayName: 'A',
    avatarUrl: null,
  };
  const token = (nonce = 'n_1') =>
    FakeOAuthProviderAdapter.mint(profile, nonce);

  beforeEach(() => {
    nonces = {
      issue: jest.fn().mockResolvedValue({ nonce: 'n_1', expiresIn: 300 }),
      consume: jest.fn().mockResolvedValue(undefined),
    };
    resolver = {
      resolve: jest.fn().mockResolvedValue({
        userId: 'u1',
        isNewUser: false,
        linked: false,
      }),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('tok') };
    users = {
      findById: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'a@example.com',
        phone: null,
        displayName: 'A',
      }),
    };
    res = { cookie: jest.fn() };

    controller = new OAuthController(
      registry,
      nonces as never,
      resolver as never,
      jwt as never,
      users as never,
      { get: (_k: string, d?: string) => d ?? '7d' } as never,
    );
  });

  it('lists only configured providers', () => {
    expect(controller.providers()).toEqual({ providers: ['google'] });
  });

  it('404s a provider that is not configured', async () => {
    await expect(controller.nonce({ provider: 'apple' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('sets an HttpOnly cookie and keeps the token out of the body', async () => {
    const result = await controller.verify(
      { provider: 'google', idToken: token(), nonce: 'n_1' } as never,
      res as never,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'tok',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(JSON.stringify(result)).not.toContain('tok');
    expect(result).toMatchObject({ success: true, user: { id: 'u1' } });
  });

  it('burns the nonce before it trusts the token', async () => {
    await controller.verify(
      { provider: 'google', idToken: token(), nonce: 'n_1' } as never,
      res as never,
    );

    // Verifying first would let an attacker probe token validity for free.
    expect(nonces.consume).toHaveBeenCalledWith('n_1', IdentityProvider.GOOGLE);
    expect(nonces.consume.mock.invocationCallOrder[0]).toBeLessThan(
      resolver.resolve.mock.invocationCallOrder[0],
    );
  });

  it('rejects a token minted for a different nonce', async () => {
    await expect(
      controller.verify(
        {
          provider: 'google',
          idToken: token('someone_elses'),
          nonce: 'n_1',
        } as never,
        res as never,
      ),
    ).rejects.toThrow();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('uses a caller-supplied name only when the token carried none', async () => {
    const anon = FakeOAuthProviderAdapter.mint(
      { ...profile, displayName: null },
      'n_1',
    );

    await controller.verify(
      {
        provider: 'google',
        idToken: anon,
        nonce: 'n_1',
        displayName: 'Ploy',
      } as never,
      res as never,
    );

    const [, passed] = resolver.resolve.mock.calls[0] as [
      unknown,
      typeof profile,
    ];
    expect(passed.displayName).toBe('Ploy');
  });

  it('never lets a caller-supplied name override the token', async () => {
    await controller.verify(
      {
        provider: 'google',
        idToken: token(),
        nonce: 'n_1',
        displayName: 'Attacker',
      } as never,
      res as never,
    );

    const [, passed] = resolver.resolve.mock.calls[0] as [
      unknown,
      typeof profile,
    ];
    expect(passed.displayName).toBe('A');
  });

  it('surfaces the refuse-to-link case as a 409', async () => {
    resolver.resolve.mockRejectedValue(new ConflictException('claimed'));

    await expect(
      controller.verify(
        { provider: 'google', idToken: token(), nonce: 'n_1' } as never,
        res as never,
      ),
    ).rejects.toThrow(ConflictException);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
