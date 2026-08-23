import { validateEnv } from './config.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgres://localhost/flick',
    JWT_SECRET: 'a'.repeat(32),
    CORS_ORIGIN: 'https://flick.co.th',
  };

  it('accepts console delivery outside production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'development',
        OTP_DELIVERY: 'console',
      }),
    ).not.toThrow();
  });

  it('refuses to boot production with console OTP delivery', () => {
    // The console adapter delivers nothing. In production that is a silent
    // total-login outage, so it must be a crash instead.
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', OTP_DELIVERY: 'console' }),
    ).toThrow(/OTP_DELIVERY/);
  });

  it('refuses to boot production with OTP delivery unset', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /OTP_DELIVERY/,
    );
  });

  it('requires SMS vendor settings when live delivery is selected', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', OTP_DELIVERY: 'live' }),
    ).toThrow(/OTP_SMS_ENDPOINT/);
  });

  it('accepts a fully configured production environment', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        OTP_DELIVERY: 'live',
        OTP_SMS_ENDPOINT: 'https://sms.example/send',
        OTP_SMS_API_KEY: 'k',
      }),
    ).not.toThrow();
  });

  it('still enforces the existing rules', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
    expect(() => validateEnv({ ...base, CORS_ORIGIN: '*' })).toThrow(
      /CORS_ORIGIN/,
    );
  });
});
