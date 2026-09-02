import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { loggerOptions } from './lib/logger.js';
import { healthRoutes } from './routes/health.js';
import { gatewayRoutes } from './gateway/routes.js';
import { ProviderRegistry } from './providers/registry.js';
import type { DB } from './db/types.js';

export interface AppDeps {
  db: Kysely<DB>;
  redis: Redis;
  registry?: ProviderRegistry;
  rateLimitPerMinute?: number;
  cacheTtlSeconds?: number;
  upstreamTimeoutMs?: number;
}

/**
 * App factory, separate from server startup, with dependencies injected.
 *
 * WHY injected rather than imported: tests build an app with their own Redis
 * and their own limits (a limit of 3 is testable, a limit of 600 is not)
 * without mutating global state or monkey-patching modules.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    // Every request gets an ID that appears in every log line it produces and
    // is returned to the client, so a user report is actionable.
    genReqId: () => randomUUID(),
    // A gateway forwards bodies it did not author. Without an explicit ceiling
    // one caller can exhaust memory with a single large POST.
    bodyLimit: 1024 * 1024,
  });

  // Security headers. contentSecurityPolicy is off because this process serves
  // JSON and SSE only — the dashboard is a separate static origin.
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(healthRoutes);
  await app.register(gatewayRoutes, {
    db: deps.db,
    redis: deps.redis,
    registry: deps.registry ?? new ProviderRegistry(),
    rateLimitPerMinute: deps.rateLimitPerMinute ?? 600,
    cacheTtlSeconds: deps.cacheTtlSeconds ?? 300,
    upstreamTimeoutMs: deps.upstreamTimeoutMs ?? 30_000,
  });

  return app;
}
