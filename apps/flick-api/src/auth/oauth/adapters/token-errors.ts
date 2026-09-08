import { errors } from 'jose';
import { OAuthTokenInvalidError } from '../oauth-provider.port';

/**
 * Reaching the provider is our problem; what the provider signed is the
 * caller's.
 *
 * JWKSTimeout and JWKSInvalid mean we could not fetch or parse the provider's
 * key set — nothing about the request was wrong, so those stay 5xx. Every
 * other JOSE failure is a statement about the token in the request body:
 * bad signature, expired, wrong audience, wrong issuer, malformed. A
 * JWKSNoMatchingKey belongs on that side too — the token named a `kid` the
 * provider does not publish.
 */
const OUR_FAULT = [errors.JWKSTimeout, errors.JWKSInvalid] as const;

export function asTokenError(err: unknown, provider: string): unknown {
  if (OUR_FAULT.some((cls) => err instanceof cls)) return err;
  if (err instanceof errors.JOSEError) {
    // err.code is a stable JOSE identifier (ERR_JWT_EXPIRED, ...) and carries
    // no part of the token, so it is safe to keep for diagnosis.
    return new OAuthTokenInvalidError(
      `${provider} id_token rejected: ${err.code}`,
    );
  }
  return err;
}
