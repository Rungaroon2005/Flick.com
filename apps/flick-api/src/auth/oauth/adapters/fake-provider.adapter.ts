import { IdentityProvider } from '@prisma/client';
import type {
  OAuthProviderPort,
  ProviderProfile,
} from '../oauth-provider.port';

/**
 * Deterministic provider for tests and e2e, mirroring FakeGatewayAdapter's role
 * in payments: it lets the whole verification path be exercised without a
 * network call or a real credential. The token IS the profile plus the nonce,
 * base64url-encoded, so a test can drive any linking branch and can prove the
 * nonce check fires.
 *
 * config.validation.ts refuses to let this be selected in production.
 */
export class FakeOAuthProviderAdapter implements OAuthProviderPort {
  constructor(readonly id: IdentityProvider) {}

  static mint(profile: ProviderProfile, nonce: string): string {
    return Buffer.from(JSON.stringify({ profile, nonce }), 'utf8').toString(
      'base64url',
    );
  }

  verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<ProviderProfile> {
    let decoded: { profile?: ProviderProfile; nonce?: string };
    try {
      decoded = JSON.parse(
        Buffer.from(idToken, 'base64url').toString('utf8'),
      ) as { profile?: ProviderProfile; nonce?: string };
    } catch {
      return Promise.reject(new Error('Fake provider: invalid token'));
    }

    if (!decoded?.profile?.providerAccountId) {
      return Promise.reject(new Error('Fake provider: invalid token'));
    }
    if (decoded.nonce !== expectedNonce) {
      return Promise.reject(new Error('Fake provider: nonce mismatch'));
    }
    return Promise.resolve(decoded.profile);
  }
}
