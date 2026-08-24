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

  it('requires EMAIL vendor settings when live delivery is selected', () => {
    // otp.module.ts always wires the email adapter into the routing
    // composite when OTP_DELIVERY=live, so a boot with SMS vars but no
    // EMAIL vars must still fail at boot, not at the first EMAIL request.
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        OTP_DELIVERY: 'live',
        OTP_SMS_ENDPOINT: 'https://sms.example/send',
        OTP_SMS_API_KEY: 'k',
      }),
    ).toThrow(/OTP_EMAIL_ENDPOINT/);
  });

  it('accepts a fully configured production environment', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        OTP_DELIVERY: 'live',
        OTP_SMS_ENDPOINT: 'https://sms.example/send',
        OTP_SMS_API_KEY: 'k',
        OTP_EMAIL_ENDPOINT: 'https://email.example/send',
        OTP_EMAIL_API_KEY: 'k',
        PAYMENT_GATEWAY: 'omise',
        OMISE_SECRET_KEY: 'skey_live_x',
        OMISE_WEBHOOK_SECRET: 'd2ViaG9vay1zZWNyZXQ=',
      }),
    ).not.toThrow();
  });

  const liveOtp = {
    OTP_DELIVERY: 'live',
    OTP_SMS_ENDPOINT: 'https://sms.example/send',
    OTP_SMS_API_KEY: 'k',
    OTP_EMAIL_ENDPOINT: 'https://email.example/send',
    OTP_EMAIL_API_KEY: 'k',
  };

  it('refuses to boot production with the fake payment gateway', () => {
    // The fake gateway accepts webhooks it signed itself — a free-access
    // mint in production.
    expect(() =>
      validateEnv({
        ...base,
        ...liveOtp,
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'fake',
      }),
    ).toThrow(/PAYMENT_GATEWAY/);
  });

  it('refuses to boot production with the payment gateway unset', () => {
    expect(() =>
      validateEnv({ ...base, ...liveOtp, NODE_ENV: 'production' }),
    ).toThrow(/PAYMENT_GATEWAY/);
  });

  it('requires OMISE_SECRET_KEY when PAYMENT_GATEWAY=omise', () => {
    expect(() =>
      validateEnv({
        ...base,
        ...liveOtp,
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'omise',
        OMISE_WEBHOOK_SECRET: 'd2ViaG9vay1zZWNyZXQ=',
      }),
    ).toThrow(/OMISE_SECRET_KEY/);
  });

  it('requires OMISE_WEBHOOK_SECRET when PAYMENT_GATEWAY=omise', () => {
    // Without this, OmiseGatewayAdapter#verifyWebhook can never positively
    // confirm a signature and — being fail-closed — would reject every
    // webhook forever.
    expect(() =>
      validateEnv({
        ...base,
        ...liveOtp,
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'omise',
        OMISE_SECRET_KEY: 'skey_live_x',
      }),
    ).toThrow(/OMISE_WEBHOOK_SECRET/);
  });

  it('enforces the omise guards outside production too, once selected', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'development',
        OTP_DELIVERY: 'console',
        PAYMENT_GATEWAY: 'omise',
      }),
    ).toThrow(/OMISE_SECRET_KEY/);
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
