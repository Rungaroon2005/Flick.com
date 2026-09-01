import { IdentityProvider } from '@prisma/client';
import { AppleProviderAdapter } from './apple-provider.adapter';

describe('AppleProviderAdapter', () => {
  it('is the Apple provider', () => {
    expect(
      new AppleProviderAdapter({ getOrThrow: () => 'cid' } as never).id,
    ).toBe(IdentityProvider.APPLE);
  });

  it('reads email_verified sent as the string "true"', () => {
    // Apple's documented shape. A boolean check alone would treat every Apple
    // user as unverified and never link any of them.
    expect(
      AppleProviderAdapter.toProfile({
        sub: '000123.abc.0001',
        email: 'a@example.com',
        email_verified: 'true',
      }),
    ).toMatchObject({
      providerAccountId: '000123.abc.0001',
      emailVerified: true,
    });
  });

  it('reads email_verified sent as the string "false" as unverified', () => {
    expect(
      AppleProviderAdapter.toProfile({
        sub: 's',
        email: 'a@example.com',
        email_verified: 'false',
      }).emailVerified,
    ).toBe(false);
  });

  it('accepts a private relay address as a real verified email', () => {
    expect(
      AppleProviderAdapter.toProfile({
        sub: 's',
        email: 'xyz@privaterelay.appleid.com',
        email_verified: 'true',
        is_private_email: 'true',
      }),
    ).toMatchObject({
      email: 'xyz@privaterelay.appleid.com',
      emailVerified: true,
    });
  });

  it('never carries a display name — Apple does not put one in the token', () => {
    expect(
      AppleProviderAdapter.toProfile({
        sub: 's',
        email: 'a@example.com',
        email_verified: 'true',
      }).displayName,
    ).toBeNull();
  });

  it('tolerates a repeat sign-in that carries no email', () => {
    // Apple sends the email only on the first authorization, ever.
    expect(AppleProviderAdapter.toProfile({ sub: 's' })).toMatchObject({
      email: null,
      emailVerified: false,
    });
  });

  it('rejects a claim set with no subject', () => {
    expect(() =>
      AppleProviderAdapter.toProfile({ email: 'a@example.com' }),
    ).toThrow(/sub/);
  });
});
