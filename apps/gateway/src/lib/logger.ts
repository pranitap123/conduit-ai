import { pino, type LoggerOptions } from 'pino';
import { env, isProduction } from '../config/env.js';

/**
 * Structured JSON logging.
 *
 * WHY pino over console.log: every line is a JSON object, so an aggregator can
 * filter by requestId or orgId. console.log produces strings nothing can query.
 *
 * The redact list is a hard requirement, not a nicety. This service handles
 * other people's provider credentials and other people's prompts. A stray
 * `logger.info({ req })` must never put an Authorization header into a log.
 * Extend this list whenever you add a field carrying a secret.
 *
 * Options are exported separately so Fastify builds its own request-scoped
 * child logger from the same config, instead of us handing it an instance and
 * fighting version skew between fastify's pino types and ours.
 */
export const loggerOptions: LoggerOptions = {
  level: env.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'apiKey',
      'providerApiKey',
      '*.providerApiKey',
    ],
    censor: '[REDACTED]',
  },
  ...(isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
};

/** For logging outside a request context: startup, shutdown, workers. */
export const logger = pino(loggerOptions);
