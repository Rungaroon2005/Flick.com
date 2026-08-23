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
    const missingVendor = ['OTP_SMS_ENDPOINT', 'OTP_SMS_API_KEY'].filter(
      (key) => !config[key],
    );
    if (missingVendor.length > 0) {
      throw new Error(
        `OTP_DELIVERY=live requires: ${missingVendor.join(', ')}`,
      );
    }
  }

  return config;
}
