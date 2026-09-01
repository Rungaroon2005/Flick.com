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
