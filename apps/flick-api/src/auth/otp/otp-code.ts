import { randomInt, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  OTP_BCRYPT_ROUNDS,
  OTP_REF_ALPHABET,
  OTP_REF_LENGTH,
} from './otp.config';

/**
 * A 6-digit code from a CSPRNG. `Math.random` is a non-cryptographic PRNG
 * whose internal state is recoverable from a handful of outputs — with it, an
 * attacker who requests a few codes for their own number can predict the code
 * sent to someone else's. `randomInt` draws from the OS entropy pool.
 */
export function generateOtpCode(): string {
  // Upper bound is exclusive, so this yields 0..999999 uniformly. Padding is
  // what makes 42 into a typable "000042".
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * A short human-readable handle shown on screen and repeated in the message,
 * so a user with two codes in their inbox knows which screen each belongs to.
 * Collision-tolerant by design: it is a display hint, never a lookup key on
 * its own — verify always scopes by destination first.
 */
export function generateOtpRef(): string {
  let ref = '';
  for (let i = 0; i < OTP_REF_LENGTH; i++) {
    ref += OTP_REF_ALPHABET[randomInt(0, OTP_REF_ALPHABET.length)];
  }
  return ref;
}

export function hashOtpCode(code: string): Promise<string> {
  return bcrypt.hash(code, OTP_BCRYPT_ROUNDS);
}

export function compareOtpCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

/**
 * Constant-time string comparison that degrades to `false` instead of throwing
 * on a length mismatch (`crypto.timingSafeEqual` requires equal lengths).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
