/**
 * Fail-fast environment config.
 *
 * WHY: a gateway that boots with a missing DATABASE_URL and only discovers it
 * on the first request has turned a startup error into a production incident.
 * Every required variable is read once, at import time, so a missing one
 * crashes the process before it ever accepts traffic.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '3000')),
  logLevel: optional('LOG_LEVEL', 'info'),

  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),

  enabledProviders: optional('ENABLED_PROVIDERS', 'mock')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  openaiApiKey: process.env.OPENAI_API_KEY ?? null,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
} as const;

export const isProduction = env.nodeEnv === 'production';
