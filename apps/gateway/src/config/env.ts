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
  /** Any OpenAI-compatible endpoint: Groq, Together, vLLM, Ollama, LiteLLM. */
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? null,

  rateLimitPerMinute: Number(optional('RATE_LIMIT_PER_MINUTE', '600')),
  cacheTtlSeconds: Number(optional('CACHE_TTL_SECONDS', '300')),
  upstreamTimeoutMs: Number(optional('UPSTREAM_TIMEOUT_MS', '30000')),

  /** Signs dashboard session tokens. Required in production only. */
  authSecret: optional('AUTH_SECRET', 'dev-only-insecure-secret'),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),
  /** Path to the built dashboard. Set in the container; unset in development. */
  staticRoot: process.env.STATIC_ROOT ?? null,
} as const;

if (isProductionEnv() && env_authSecretIsDefault()) {
  throw new Error('AUTH_SECRET must be set in production');
}
function isProductionEnv(): boolean { return (process.env.NODE_ENV ?? '') === 'production'; }
function env_authSecretIsDefault(): boolean {
  return (process.env.AUTH_SECRET ?? '') === '';
}

export const isProduction = env.nodeEnv === 'production';
