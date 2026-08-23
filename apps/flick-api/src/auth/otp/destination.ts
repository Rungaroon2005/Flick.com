import { BadRequestException } from '@nestjs/common';
import { OtpChannel } from '@prisma/client';

const INVALID_PHONE = 'เบอร์โทรศัพท์ไม่ถูกต้อง (Invalid phone number)';
const INVALID_EMAIL = 'อีเมลไม่ถูกต้อง (Invalid email)';

/** Deliberately loose — real validation is "can we deliver to it", not a regex. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_SHAPE = /^\+[1-9]\d{7,14}$/;

/**
 * Collapses every way a Thai user might type their number into one canonical
 * E.164 string. This runs BEFORE any database lookup — `0812345678` and
 * `+66812345678` must resolve to the same `User` row, and must share one
 * rate-limit bucket.
 */
function normalizeThaiPhone(raw: string): string {
  const trimmed = raw.trim();

  // FINDING 1 FIX: Validate allowed characters before processing to reject junk input.
  // Allowed: digits, spaces, hyphens, parentheses, dots, and optional single leading '+'.
  if (!/^\+?[\d\s\-().]*$/.test(trimmed)) {
    throw new BadRequestException(INVALID_PHONE);
  }

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  let e164: string;
  if (hadPlus) {
    e164 = `+${digits}`;
  } else if (digits.startsWith('66') && digits.length === 11) {
    e164 = `+${digits}`;
  } else if (digits.startsWith('0') && digits.length === 10) {
    // Thai national format: drop the trunk '0', prepend the country code.
    e164 = `+66${digits.slice(1)}`;
  } else {
    throw new BadRequestException(INVALID_PHONE);
  }

  if (!E164_SHAPE.test(e164)) throw new BadRequestException(INVALID_PHONE);

  // FINDING 2 FIX: For Thai numbers (+66), reject if national significant number starts with 0.
  // A leading 0 after +66 violates E.164 standards for Thai numbers.
  if (e164.startsWith('+66') && e164[3] === '0') {
    throw new BadRequestException(INVALID_PHONE);
  }

  return e164;
}

export function normalizeDestination(raw: string, channel: OtpChannel): string {
  if (channel === OtpChannel.EMAIL) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(email)) throw new BadRequestException(INVALID_EMAIL);
    return email;
  }
  return normalizeThaiPhone(raw);
}

/**
 * Log-safe rendering. A destination is PII and an OTP-delivery target; full
 * values must never reach a log aggregator.
 */
export function maskDestination(destination: string): string {
  if (destination.includes('@')) {
    const [local, domain] = destination.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }

  // FINDING 3 FIX: Ensure output can never contain the full input, even for short strings.
  // For strings ≤5 chars, show only first and last character to prevent full exposure.
  if (destination.length <= 5) {
    return `${destination.slice(0, 1)}****${destination.slice(-1)}`;
  }
  return `${destination.slice(0, 5)}****${destination.slice(-2)}`;
}
