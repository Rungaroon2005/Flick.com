import {
  compareOtpCode,
  generateOtpCode,
  generateOtpRef,
  hashOtpCode,
  timingSafeEqualString,
} from './otp-code';
import { OTP_REF_ALPHABET, OTP_REF_LENGTH } from './otp.config';

describe('generateOtpCode', () => {
  it('always produces exactly 6 digits, including low values', () => {
    // Zero-padding matters: randomInt can return 42, and "42" is not a
    // 6-digit code the user can type back.
    for (let i = 0; i < 500; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('does not collapse to a small set of values', () => {
    const seen = new Set(Array.from({ length: 300 }, () => generateOtpCode()));
    expect(seen.size).toBeGreaterThan(200);
  });
});

describe('generateOtpRef', () => {
  it('uses only unambiguous alphabet characters', () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateOtpRef();
      expect(ref).toHaveLength(OTP_REF_LENGTH);
      for (const ch of ref) expect(OTP_REF_ALPHABET).toContain(ch);
    }
  });
});

describe('hashOtpCode / compareOtpCode', () => {
  it('never stores the plaintext code in the hash', async () => {
    const hash = await hashOtpCode('123456');
    expect(hash).not.toContain('123456');
  });

  it('accepts the right code and rejects a wrong one', async () => {
    const hash = await hashOtpCode('123456');
    await expect(compareOtpCode('123456', hash)).resolves.toBe(true);
    await expect(compareOtpCode('123457', hash)).resolves.toBe(false);
  });
});

describe('timingSafeEqualString', () => {
  it('matches identical strings and rejects different ones', () => {
    expect(timingSafeEqualString('AB2C', 'AB2C')).toBe(true);
    expect(timingSafeEqualString('AB2C', 'AB2D')).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', () => {
    // crypto.timingSafeEqual throws on unequal buffer lengths; an attacker
    // must not be able to turn that into a 500.
    expect(timingSafeEqualString('AB2C', 'AB')).toBe(false);
    expect(timingSafeEqualString('', 'AB2C')).toBe(false);
  });
});
