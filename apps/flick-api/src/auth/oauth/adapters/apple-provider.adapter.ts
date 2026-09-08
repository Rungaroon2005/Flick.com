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

const JWKS_URI = 'https://appleid.apple.com/auth/keys';
const ISSUER = 'https://appleid.apple.com';

/**
 * Apple sends this as the STRING "true"/"false", not a boolean. A truthiness
 * check would read "false" as verified; a strict boolean check would treat every
 * Apple user as unverified and never link any of them.
 */
function isVerified(claim: unknown): boolean {
  return claim === true || claim === 'true';
}

@Injectable()
export class AppleProviderAdapter implements OAuthProviderPort {
  readonly id = IdentityProvider.APPLE;
  private readonly jwks = createRemoteJWKSet(new URL(JWKS_URI));

  constructor(private readonly config: ConfigService) {}

  async verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<ProviderProfile> {
    // No client secret anywhere: we verify the token Apple signed and never
    // exchange the authorization code, so there is no .p8 key to mint an ES256
    // assertion from and no 6-month rotation to schedule.
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ISSUER,
        audience: this.config.getOrThrow<string>('APPLE_CLIENT_ID'),
      }));
    } catch (err) {
      throw asTokenError(err, 'Apple');
    }

    if (payload.nonce !== expectedNonce) {
      throw new OAuthTokenInvalidError(
        'Apple id_token nonce did not match the issued nonce',
      );
    }

    return AppleProviderAdapter.toProfile(payload);
  }

  /** Pure claim-set → profile mapping, static so it tests without a network. */
  static toProfile(claims: Record<string, unknown>): ProviderProfile {
    const sub = claims.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new OAuthTokenInvalidError('Apple id_token carried no sub');
    }
    // Absent on every sign-in after the first: Apple sends the email once, ever.
    const email = typeof claims.email === 'string' ? claims.email : null;

    return {
      providerAccountId: sub,
      // A private relay address is a real, verified, forwarding address. Stored
      // as-is; is_private_email would change no decision we make.
      email,
      emailVerified: email !== null && isVerified(claims.email_verified),
      // Apple puts no name in the token. It arrives beside it, once, in the JS
      // response — the controller fills it from the request body, treating it
      // as an unverified hint. This adapter must not invent one.
      displayName: null,
      avatarUrl: null,
    };
  }
}
