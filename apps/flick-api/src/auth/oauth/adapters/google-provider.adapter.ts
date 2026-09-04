import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityProvider } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  OAuthTokenInvalidError,
  type OAuthProviderPort,
  type ProviderProfile,
} from '../oauth-provider.port';
import { asTokenError } from './token-errors';

const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Only a real boolean true, or the exact string "true", counts as verified. */
function isVerified(claim: unknown): boolean {
  return claim === true || claim === 'true';
}

@Injectable()
export class GoogleProviderAdapter implements OAuthProviderPort {
  readonly id = IdentityProvider.GOOGLE;
  private readonly jwks = createRemoteJWKSet(new URL(JWKS_URI));

  constructor(private readonly config: ConfigService) {}

  async verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<ProviderProfile> {
    // Signature, issuer, audience and expiry. A well-signed token issued for a
    // different client is not a login here.
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ISSUERS,
        audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      }));
    } catch (err) {
      throw asTokenError(err, 'Google');
    }

    // The replay guard: this token was minted for one nonce we issued once.
    if (payload.nonce !== expectedNonce) {
      throw new OAuthTokenInvalidError(
        'Google id_token nonce did not match the issued nonce',
      );
    }

    return GoogleProviderAdapter.toProfile(payload);
  }

  /** Pure claim-set → profile mapping, static so it tests without a network. */
  static toProfile(claims: Record<string, unknown>): ProviderProfile {
    const sub = claims.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new OAuthTokenInvalidError('Google id_token carried no sub');
    }
    const email = typeof claims.email === 'string' ? claims.email : null;
    return {
      providerAccountId: sub,
      email,
      emailVerified: email !== null && isVerified(claims.email_verified),
      displayName: typeof claims.name === 'string' ? claims.name : null,
      avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
    };
  }
}
