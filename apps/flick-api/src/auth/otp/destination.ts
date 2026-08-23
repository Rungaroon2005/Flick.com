import { BadRequestException } from '@nestjs/common';
import { OtpChannel } from '@prisma/client';

const INVALID_PHONE = 'เบอร์โทรศัพท์ไม่ถูกต้อง (Invalid phone number)';
const INVALID_EMAIL = 'อีเมลไม่ถูกต้อง (Invalid email)';

/** Deliberately loose; real validation is "can we deliver to it", not a regex. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_SHAPE = /^\+[1-9]\d{7,14}$/;

/**
 * Collapses every way a Thai user might type their number into one canonical
 * E.164 string. This runs before database lookup so equivalent phone spellings
 * resolve to one user and one rate-limit bucket.
 */
function normalizeThaiPhone(raw: string): string {
  const trimmed = raw.trim();
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
  return `${destination.slice(0, 5)}****${destination.slice(-2)}`;
}
