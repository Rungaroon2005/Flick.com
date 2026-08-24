const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGIN'] as const;

export function validateEnv(config: Record<string, unknown>) {
  const missing = REQUIRED_ENV.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  if (String(config.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }

  const origins = String(config.CORS_ORIGIN)
    .split(',')
    .map((origin) => origin.trim());
  if (origins.includes('*')) {
    throw new Error(
      'CORS_ORIGIN must list explicit origins when using credentials',
    );
  }

  const isProduction = config.NODE_ENV === 'production';
  const otpDelivery = config.OTP_DELIVERY;

  if (isProduction && otpDelivery !== 'live') {
    throw new Error(
      'OTP_DELIVERY must be "live" in production — the console adapter logs codes instead of sending them, which silently locks every user out',
    );
  }

  if (otpDelivery === 'live') {
    const missingVendor = [
      'OTP_SMS_ENDPOINT',
      'OTP_SMS_API_KEY',
      'OTP_EMAIL_ENDPOINT',
      'OTP_EMAIL_API_KEY',
    ].filter((key) => !config[key]);
    if (missingVendor.length > 0) {
      throw new Error(
        `OTP_DELIVERY=live requires: ${missingVendor.join(', ')}`,
      );
    }
  }

  if (isProduction && config.PAYMENT_GATEWAY !== 'omise') {
    throw new Error(
      'PAYMENT_GATEWAY must be a real gateway in production — the fake gateway accepts self-signed webhooks and would mint free access',
    );
  }

  if (config.PAYMENT_GATEWAY === 'omise') {
    // OMISE_SECRET_KEY authenticates our outbound REST calls (charge
    // creation). OMISE_WEBHOOK_SECRET is a *separate* credential — it is
    // the HMAC key Omise signs inbound webhooks with (see the research
    // notes at the top of omise-gateway.adapter.ts). Both are required:
    // without the first we cannot create checkouts, without the second
    // verifyWebhook can never positively confirm authenticity and (being
    // fail-closed) would reject every webhook forever. Note this replaces
    // the plan's originally-suggested "PAYMENT_WEBHOOK_SECRET required in
    // production" rule: PAYMENT_WEBHOOK_SECRET is the fake gateway's own
    // dev/test HMAC secret and has no meaning for Omise's real
    // verification, and production can never select the fake gateway
    // anyway (see the rule above).
    const missingOmise = ['OMISE_SECRET_KEY', 'OMISE_WEBHOOK_SECRET'].filter(
      (key) => !config[key],
    );
    if (missingOmise.length > 0) {
      throw new Error(
        `PAYMENT_GATEWAY=omise requires: ${missingOmise.join(', ')}`,
      );
    }
  }

  return config;
}
