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

  return config;
}
