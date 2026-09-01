import { IdentityProvider } from '@prisma/client';
import { GoogleProviderAdapter } from './google-provider.adapter';

describe('GoogleProviderAdapter', () => {
  it('is the Google provider', () => {
    expect(
      new GoogleProviderAdapter({ getOrThrow: () => 'cid' } as never).id,
    ).toBe(IdentityProvider.GOOGLE);
  });

  it('maps a verified claim set to a profile', () => {
    expect(
      GoogleProviderAdapter.toProfile({
        sub: '1234567890',
        email: 'a@example.com',
        email_verified: true,
        name: 'Somchai',
        picture: 'https://lh3.googleusercontent.com/a',
      }),
    ).toEqual({
      providerAccountId: '1234567890',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'Somchai',
      avatarUrl: 'https://lh3.googleusercontent.com/a',
    });
  });

  it('treats the string "false" as unverified, not as truthy', () => {
    // A truthiness check would read "false" as verified and let the linking
    // rule match an address nobody proved.
    expect(
      GoogleProviderAdapter.toProfile({
        sub: 's',
        email: 'a@example.com',
        email_verified: 'false',
      }).emailVerified,
    ).toBe(false);
  });

  it('accepts the string "true" as verified', () => {
    expect(
      GoogleProviderAdapter.toProfile({
        sub: 's',
        email: 'a@example.com',
        email_verified: 'true',
      }).emailVerified,
    ).toBe(true);
  });

  it('never reports a verified email when there is no email', () => {
    expect(
      GoogleProviderAdapter.toProfile({ sub: 's', email_verified: true }),
    ).toMatchObject({ email: null, emailVerified: false });
  });

  it('rejects a claim set with no subject', () => {
    expect(() =>
      GoogleProviderAdapter.toProfile({ email: 'a@example.com' }),
    ).toThrow(/sub/);
  });
});
