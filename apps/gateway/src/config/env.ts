/**
 * Fail-fast environment config.
 *
 * WHY: a gateway that boots with a missing DATABASE_URL and only discovers it
 * on the first request has turned a startup error into a production incident.
 * Everything is read and validated once, before the process opens a port.
 *
 * `loadConfig` is a pure function of an environment object rather than reading
 * `process.env` directly, so the validation rules can be tested by calling it
 * with different inputs. Testing them any other way means mutating
 * `process.env` and busting the module cache, which is brittle and leaks state
 * between test files.
 */

export type EnvSource = Record<string, string | undefined>;

export class ConfigError extends Error {
  readonly variable: string;
  constructor(variable: string, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

/**
 * Secrets that have appeared as placeholders in this repository, its
 * documentation, or its compose file. Any of them reaching production means a
 * placeholder was deployed rather than a real secret being generated.
 *
 * Compared case-insensitively after trimming, because `Change-Me` is the same
 * mistake as `change-me`.
 *
 * This list is a backstop, not the primary control — the length and entropy
 * checks below catch placeholders nobody thought to add here.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'change-me-before-deploying',
  'change-me',
  'changeme',
  'dev-only-insecure-secret',
  'development',
  'secret',
  'password',
  'test',
  'tollgate',
  'conduit',
  'your-secret-here',
]);

/**
 * 32 characters. `openssl rand -base64 32` produces 44, so the documented
 * command clears this comfortably; the bar exists to reject a human-typed
 * password being used where a generated secret belongs.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Development-only fallback. It is a member of the placeholder set above, so if
 * this value ever reaches production the check below rejects it — the fallback
 * cannot become an accidental production secret.
 */
const DEV_AUTH_SECRET = 'dev-only-insecure-secret';

function required(source: EnvSource, name: string): string {
  const value = source[name];
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(name, `Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(source: EnvSource, name: string, fallback: string): string {
  const value = source[name];
  return value === undefined || value === '' ? fallback : value;
}

/**
 * Rejects a session-signing secret that is absent, a known placeholder, too
 * short, or too repetitive to be random.
 *
 * Enforced only in production. In development a weak secret is not a risk worth
 * blocking work over, and forcing every contributor to generate one before
 * `npm run dev` would push people toward committing a shared value.
 */
export function validateAuthSecret(value: string | undefined, isProd: boolean): string {
  if (!isProd) {
    return value === undefined || value === '' ? DEV_AUTH_SECRET : value;
  }

  if (value === undefined || value.trim() === '') {
    throw new ConfigError(
      'AUTH_SECRET',
      'AUTH_SECRET must be set in production. Generate one with: openssl rand -base64 32',
    );
  }

  const normalised = value.trim().toLowerCase();

  if (KNOWN_PLACEHOLDER_SECRETS.has(normalised)) {
    throw new ConfigError(
      'AUTH_SECRET',
      'AUTH_SECRET is a known placeholder value and must not be used in production. '
      + 'Generate one with: openssl rand -base64 32',
    );
  }

  if (value.trim().length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      'AUTH_SECRET',
      `AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production `
      + `(got ${value.trim().length}). Generate one with: openssl rand -base64 32`,
    );
  }

  // Catches padded placeholders that clear the length bar without being random,
  // such as a single character repeated or a short word typed over and over.
  if (new Set(value.trim()).size < 8) {
    throw new ConfigError(
      'AUTH_SECRET',
      'AUTH_SECRET does not look randomly generated — it uses fewer than 8 distinct '
      + 'characters. Generate one with: openssl rand -base64 32',
    );
  }

  return value;
}

export function loadConfig(source: EnvSource) {
  const nodeEnv = optional(source, 'NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';

  return {
    nodeEnv,
    isProduction: isProd,
    port: Number(optional(source, 'PORT', '3000')),
    logLevel: optional(source, 'LOG_LEVEL', 'info'),

    databaseUrl: required(source, 'DATABASE_URL'),
    redisUrl: required(source, 'REDIS_URL'),

    enabledProviders: optional(source, 'ENABLED_PROVIDERS', 'mock')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),

    openaiApiKey: source.OPENAI_API_KEY ?? null,
    /** Any OpenAI-compatible endpoint: Groq, Together, vLLM, Ollama, LiteLLM. */
    openaiBaseUrl: source.OPENAI_BASE_URL ?? null,

    rateLimitPerMinute: Number(optional(source, 'RATE_LIMIT_PER_MINUTE', '600')),
    cacheTtlSeconds: Number(optional(source, 'CACHE_TTL_SECONDS', '300')),
    upstreamTimeoutMs: Number(optional(source, 'UPSTREAM_TIMEOUT_MS', '30000')),

    /** Signs dashboard session tokens. Rotating it invalidates every session. */
    authSecret: validateAuthSecret(source.AUTH_SECRET, isProd),
    corsOrigin: optional(source, 'CORS_ORIGIN', 'http://localhost:5173'),
    /** Path to the built dashboard. Set in the container; unset in development. */
    staticRoot: source.STATIC_ROOT ?? null,
  } as const;
}

/**
 * A configuration error is an operator mistake, not a bug, so it gets a clean
 * one-line message and a non-zero exit rather than a stack trace. Exiting here
 * — during module evaluation — is what guarantees the process never reaches
 * `listen()` with an invalid configuration.
 */
function loadOrExit(): ReturnType<typeof loadConfig> {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`\nConfiguration error: ${err.message}\n\n`);
      process.exit(1);
    }
    throw err;
  }
}

export const env = loadOrExit();
export const isProduction = env.isProduction;