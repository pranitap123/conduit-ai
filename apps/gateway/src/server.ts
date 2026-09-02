import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

const app = buildApp();

/**
 * Graceful shutdown: stop accepting new connections, let in-flight requests
 * finish, then exit. A gateway that hard-exits mid-request leaves the caller
 * with a dropped connection and an unrecorded usage row.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

app
  .listen({ port: env.port, host: '0.0.0.0' })
  .catch((err: unknown) => {
    logger.error({ err }, 'failed to start');
    process.exit(1);
  });
