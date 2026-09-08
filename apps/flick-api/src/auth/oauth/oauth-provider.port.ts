import { IdentityProvider } from '@prisma/client';

/** DI token for the provider registry. */
export const OAUTH_PROVIDER_REGISTRY = 'OAUTH_PROVIDER_REGISTRY';

/**
 * The ONLY shape IdentityResolver ever sees. No provider-specific field may be
 * added here: the moment the resolver can tell Google from Apple, the linking
 * rules start growing per-provider branches.
 */
export interface ProviderProfile {
  /** The provider's stable subject id. Never an email. */
  providerAccountId: string;
  email: string | null;
  /** A real boolean. Apple sends the STRING "true"; adapters must parse it. */
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * The token is the caller's problem: malformed, expired, signed by the wrong
 * key, minted for another audience, or carrying a nonce we did not issue. The
 * controller answers 401 for these, so a user holding a stale token is told to
 * sign in again.
 *
 * What an adapter does NOT wrap in this stays a 5xx — a JWKS fetch that timed
 * out is our outage, and laundering it into a 401 would blame the user and
 * hide it. Adapters decide which is which; they are the only layer that knows
 * a provider's failure modes.
 */
export class OAuthTokenInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthTokenInvalidError';
  }
}

export interface OAuthProviderPort {
  readonly id: IdentityProvider;
  /**
   * Verifies signature against the provider's JWKS, plus iss, aud, exp, and
   * that the token's nonce equals `expectedNonce`. Rejects otherwise. A
   * well-signed token issued for a different application is not a login.
   */
  verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<ProviderProfile>;
}

/** provider id → adapter. A provider absent here is not configured. */
export type OAuthProviderRegistry = Map<IdentityProvider, OAuthProviderPort>;
