import { IdentityProvider } from '@prisma/client';
import { FakeOAuthProviderAdapter } from './fake-provider.adapter';

describe('FakeOAuthProviderAdapter', () => {
  const adapter = new FakeOAuthProviderAdapter(IdentityProvider.GOOGLE);

  const profile = {
    providerAccountId: 'sub_1',
    email: 'a@example.com',
    emailVerified: true,
    displayName: 'A',
    avatarUrl: null,
  };

  it('decodes a profile from the token so tests can choose one', async () => {
    const token = FakeOAuthProviderAdapter.mint(profile, 'nonce_1');

    await expect(adapter.verifyIdToken(token, 'nonce_1')).resolves.toEqual(
      profile,
    );
  });

  it('rejects a token whose nonce does not match the one we issued', async () => {
    const token = FakeOAuthProviderAdapter.mint(profile, 'nonce_1');

    // The replay guard. A captured token carries the nonce it was minted with.
    await expect(adapter.verifyIdToken(token, 'nonce_2')).rejects.toThrow(
      /nonce/i,
    );
  });

  it('rejects a token it did not mint', async () => {
    await expect(adapter.verifyIdToken('garbage', 'nonce_1')).rejects.toThrow(
      /invalid token/i,
    );
  });
});
