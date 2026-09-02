import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { loggerOptions } from './lib/logger.js';
import { healthRoutes } from './routes/health.js';

/**
 * App factory, separate from server startup.
 *
 * WHY: tests need an app instance they can drive with `app.inject()` without
 * binding a TCP port. Mixing construction and `listen()` in one file makes
 * every integration test race on port allocation.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: loggerOptions,

    // Every request gets an ID that appears in every log line it produces and
    // is returned to the client. When a user reports "request X was slow",
    // this is what makes their report actionable.
    genReqId: () => randomUUID(),

    // A gateway forwards bodies it did not author. Without an explicit ceiling
    // a single caller can exhaust memory with one large POST.
    bodyLimit: 1024 * 1024, // 1 MB
  });

  app.register(healthRoutes);

  return app;
}
