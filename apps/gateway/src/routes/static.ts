import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Serves the built dashboard from the gateway in production.
 *
 * WHY one origin instead of a separate static host: the session lives in a
 * cookie. Same-origin means the cookie is first-party, CORS is not involved at
 * all, and there is no allowlist to get wrong. It also means one container to
 * deploy. The cost is that a dashboard asset change requires redeploying the
 * API — acceptable for a single-service product.
 */
export async function staticRoutes(app: FastifyInstance, opts: { root: string }): Promise<void> {
  if (!existsSync(opts.root)) {
    app.log.warn({ root: opts.root }, 'dashboard build not found; API-only mode');
    return;
  }

  await app.register(fastifyStatic, {
    root: opts.root,
    // Hashed filenames are immutable; index.html must never be cached or a
    // deploy would keep serving the old asset references.
    // Hashed asset filenames are immutable and cached for a year. index.html
    // is excluded below, or a deploy would keep serving stale asset references.
    maxAge: '1y',
    cacheControl: true,
  });

  app.addHook('onSend', async (req, reply) => {
    if (req.url === '/' || req.url.startsWith('/app') || req.url.endsWith('.html')) {
      reply.header('cache-control', 'no-store');
    }
  });

  // Client-side routing: any non-API path that is not a real file returns the
  // shell, so a hard refresh on /app/requests works.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/v1/')) {
      return reply.code(404).send({
        error: { type: 'not_found', message: 'Unknown endpoint', requestId: req.id },
      });
    }
    return reply.sendFile('index.html');
  });
}
