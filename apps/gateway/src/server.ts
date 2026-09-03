import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closeDb, db } from './db/client.js';
import { closeRedis, getRedis } from './lib/redis.js';
import { logger } from './lib/logger.js';
import { migrate } from './db/migrate.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const redis = await getRedis();
await migrate();
const app = await buildApp({
  db, redis,
  rateLimitPerMinute: env.rateLimitPerMinute,
  cacheTtlSeconds: env.cacheTtlSeconds,
  upstreamTimeoutMs: env.upstreamTimeoutMs,
  authSecret: env.authSecret,
  corsOrigin: env.corsOrigin,
  secureCookies: env.nodeEnv === 'production' && process.env.SECURE_COOKIES !== 'false',
  trustProxy: env.nodeEnv === 'production',
  ...(env.staticRoot === null ? {} : { staticRoot: resolve(env.staticRoot) }),
});

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish,
 * then release the pools. A gateway that hard-exits mid-request leaves the
 * caller with a dropped connection AND an unwritten ledger row.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  try {
    await app.close();
    await closeRedis();
    await closeDb();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
} catch (err) {
  logger.error({ err }, 'failed to start');
  process.exit(1);
}
