import { BadRequestException } from '@nestjs/common';
import { OtpChannel } from '@prisma/client';
import { maskDestination, normalizeDestination } from './destination';

describe('normalizeDestination', () => {
  const sms = (raw: string) => normalizeDestination(raw, OtpChannel.SMS);

  it('maps every Thai spelling of one number to the same E.164 string', () => {
    // This equivalence IS the feature: these must not become separate accounts.
    const expected = '+66812345678';
    expect(sms('0812345678')).toBe(expected);
    expect(sms('081-234-5678')).toBe(expected);
    expect(sms(' 081 234 5678 ')).toBe(expected);
    expect(sms('+66812345678')).toBe(expected);
    expect(sms('+66 81 234 5678')).toBe(expected);
    expect(sms('66812345678')).toBe(expected);
  });

  it('rejects numbers that are not plausible E.164', () => {
    expect(() => sms('123')).toThrow(BadRequestException);
    expect(() => sms('08123456789012345')).toThrow(BadRequestException);
    expect(() => sms('not-a-phone')).toThrow(BadRequestException);
    expect(() => sms('')).toThrow(BadRequestException);
  });

  it('lowercases and trims email destinations', () => {
    expect(normalizeDestination('  User@Example.COM ', OtpChannel.EMAIL)).toBe(
      'user@example.com',
    );
  });

  it('rejects malformed email destinations', () => {
    expect(() => normalizeDestination('nope', OtpChannel.EMAIL)).toThrow(
      BadRequestException,
    );
  });

  it('rejects raw input with characters outside digits, spaces, hyphens, parens, dots, and leading +', () => {
    expect(() => sms('aaa0812345678bbb')).toThrow(BadRequestException);
    expect(() => sms('Order #0812345678')).toThrow(BadRequestException);
  });

  it('rejects Thai numbers with leading zero in national significant number', () => {
    expect(() => sms('0000000000')).toThrow(BadRequestException);
  });
});

describe('maskDestination', () => {
  it('never returns the full phone number', () => {
    const masked = maskDestination('+66812345678');
    expect(masked).not.toBe('+66812345678');
    expect(masked).not.toContain('2345');
  });

  it('never returns the full email local part', () => {
    const masked = maskDestination('someone@example.com');
    expect(masked).not.toContain('someone');
    expect(masked).toContain('example.com');
  });

  it('never returns full input even for short destinations', () => {
    const masked5 = maskDestination('12345');
    expect(masked5).not.toBe('12345');
    expect(masked5).not.toContain('12345');
    const masked1 = maskDestination('1');
    expect(masked1).not.toBe('1');
  });
});
