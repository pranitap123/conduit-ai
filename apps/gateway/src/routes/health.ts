import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: is the process up? Never touches dependencies, so a slow database
  // does not cause the orchestrator to kill an otherwise healthy process.
  app.get('/health', async () => ({ status: 'ok' }));

  // Readiness: should this instance receive traffic? This one DOES check
  // dependencies. TODO(you): ping Postgres and Redis here once they are wired.
  app.get('/ready', async () => ({ status: 'ok', checks: {} }));
}
