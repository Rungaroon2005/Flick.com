/** Every OTP tunable, in one place. See the spec's "Why each control exists". */

export const OTP_TTL_MS = 5 * 60 * 1000;

/** Wrong guesses allowed before the challenge is burned outright. */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Lower than the password cost (12) on purpose. The code space is only 10^6
 * and the TTL is 5 minutes, so offline-brute-force resistance is bounded by
 * expiry, not by hash cost — and this hash is computed inside the verify
 * transaction, where latency holds a database connection open.
 */
export const OTP_BCRYPT_ROUNDS = 10;

// --- Per-destination rate limits (financial-DoS and SMS-bombing controls) ---
export const OTP_COOLDOWN_MS = 60 * 1000;
export const OTP_SHORT_WINDOW_MS = 15 * 60 * 1000;
export const OTP_SHORT_WINDOW_MAX = 3;
export const OTP_LONG_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OTP_LONG_WINDOW_MAX = 10;

/**
 * Service-wide 24h send ceiling. Every SMS costs money, so an attacker
 * spraying thousands of distinct destinations is a billing attack that
 * per-destination limits cannot see. Override with OTP_GLOBAL_DAILY_CAP.
 */
export const DEFAULT_OTP_GLOBAL_DAILY_CAP = 5000;

/** Unambiguous characters only — no I/O/0/1, which users mistype off a screen. */
export const OTP_REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const OTP_REF_LENGTH = 4;
