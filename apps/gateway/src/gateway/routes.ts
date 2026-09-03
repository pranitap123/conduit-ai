import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import { authenticateApiKey, type AuthContext } from '../auth/apiKeys.js';
import { computeCost, lookupPricing } from '../billing/cost.js';
import { ResponseCache } from '../cache/responseCache.js';
import type { DB, RequestStatus } from '../db/types.js';
import { RateLimiter } from '../limits/rateLimiter.js';
import { ProviderRegistry } from '../providers/registry.js';
import { ProviderError, type CompletionRequest, type TokenUsage } from '../providers/types.js';
import { apiError } from './errors.js';
import { findReplay, isUniqueViolation, recordUsage } from './usage.js';

const bodySchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(200_000),
  })).min(1).max(200),
  max_tokens: z.number().int().positive().max(100_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
});

export interface GatewayDeps {
  db: Kysely<DB>;
  redis: Redis;
  registry: ProviderRegistry;
  rateLimitPerMinute: number;
  cacheTtlSeconds: number;
  upstreamTimeoutMs: number;
}

export async function gatewayRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
  const limiter = new RateLimiter(deps.redis);
  const cache = new ResponseCache(deps.redis, deps.cacheTtlSeconds);

  app.post('/v1/chat/completions', async (request, reply) => {
    const startedAt = performance.now();
    const requestId = request.id;

    // ---- 1. authenticate ------------------------------------------------
    const header = request.headers.authorization;
    const raw = header?.startsWith('Bearer ') === true ? header.slice(7) : null;
    if (raw === null) {
      return reply.code(401).send(
        apiError('authentication_error', 'Missing Authorization: Bearer <key>', requestId));
    }

    const auth = await authenticateApiKey(deps.db, raw);
    if (!auth.ok) {
      // Every failure reason returns the same body. Telling a caller "that key
      // is revoked" confirms the key is real, which helps only an attacker.
      request.log.warn({ reason: auth.reason }, 'api key rejected');
      return reply.code(401).send(
        apiError('authentication_error', 'Invalid API key', requestId));
    }
    const ctx: AuthContext = auth.ctx;

    // ---- 2. validate ----------------------------------------------------
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(
        apiError('invalid_request_error', parsed.error.issues[0]?.message ?? 'Invalid body', requestId));
    }
    const body = parsed.data;
    const completion: CompletionRequest = {
      model: body.model,
      messages: body.messages,
      ...(body.max_tokens === undefined ? {} : { maxTokens: body.max_tokens }),
      ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
    };
    const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
      ? request.headers['idempotency-key'] : null;

    // ---- 2b. idempotent replay ------------------------------------------
    // Scoped to org: two tenants may legitimately pick the same key string,
    // and one must never receive the other's replayed response.
    if (idempotencyKey !== null && body.stream !== true) {
      const replay = await findReplay(deps.db, ctx.orgId, idempotencyKey);
      if (replay !== null) {
        reply.header('x-conduit-idempotent-replay', 'true');
        // Deliberately NOT re-recorded. The point of idempotency is that one
        // logical request bills once, however many times it is retried.
        return reply.code(replay.statusCode).send(replay.responseBody);
      }
    }

    // Shared tail: one ledger row per request, whatever happened.
    const finish = async (args: {
      status: RequestStatus; statusCode: number; provider: string;
      usage: TokenUsage | null; upstreamMs: number | null;
      cacheHit: boolean; streamed: boolean;
      errorCode?: string; errorMessage?: string;
      responseBody?: unknown;
    }): Promise<void> => {
      const pricing = await lookupPricing(deps.db, args.provider, body.model);
      const cost = computeCost(args.usage, pricing);
      await recordUsage(deps.db, {
        ctx,
        provider: args.provider,
        model: body.model,
        status: args.status,
        statusCode: args.statusCode,
        latencyMs: Math.round(performance.now() - startedAt),
        upstreamMs: args.upstreamMs,
        promptTokens: args.usage?.promptTokens ?? null,
        completionTokens: args.usage?.completionTokens ?? null,
        costUsd: cost.known ? cost.costUsd : null,
        costKnown: cost.known,
        cacheHit: args.cacheHit,
        streamed: args.streamed,
        retryCount: 0,
        errorCode: args.errorCode ?? null,
        errorMessage: args.errorMessage ?? null,
        idempotencyKey,
        responseBody: args.responseBody ?? null,
      });
    };

    // A failure to write the ledger must not be swallowed, EXCEPT for the
    // idempotency race, where losing the unique-index contest is the expected
    // outcome rather than an error.
    const finishTolerant = async (
      args: Parameters<typeof finish>[0],
    ): Promise<'written' | 'duplicate'> => {
      try {
        await finish(args);
        return 'written';
      } catch (err) {
        if (isUniqueViolation(err)) return 'duplicate';
        throw err;
      }
    };

    // ---- 3. rate limit --------------------------------------------------
    // Keyed by API key: the finest-grained subject the caller controls, so one
    // noisy key cannot exhaust its whole org's quota.
    const rl = await limiter.check(`key:${ctx.apiKeyId}`, deps.rateLimitPerMinute, 60_000);
    reply.header('x-ratelimit-limit', String(rl.limit));
    reply.header('x-ratelimit-remaining', String(rl.remaining));
    if (!rl.allowed) {
      reply.header('retry-after', String(rl.retryAfterSeconds));
      await finishTolerant({
        status: 'RATE_LIMITED', statusCode: 429, provider: 'none',
        usage: null, upstreamMs: null, cacheHit: false, streamed: false,
        errorCode: 'rate_limit_exceeded',
      });
      return reply.code(429).send(
        apiError('rate_limit_error', 'Rate limit exceeded', requestId));
    }

    // ---- 4. resolve provider --------------------------------------------
    const provider = deps.registry.resolve(body.model);
    if (provider === null) {
      await finishTolerant({
        status: 'CLIENT_ERROR', statusCode: 404, provider: 'none',
        usage: null, upstreamMs: null, cacheHit: false, streamed: false,
        errorCode: 'model_not_found',
      });
      return reply.code(404).send(
        apiError('invalid_request_error', `No provider serves model '${body.model}'`, requestId));
    }

    // ---- 5. cache (non-streaming only) ----------------------------------
    if (body.stream !== true) {
      const hit = await cache.get(ctx, completion);
      if (hit !== null) {
        reply.header('x-conduit-cache', 'HIT');
        // A cache hit costs nothing upstream, so cost is recorded as a known
        // zero — genuinely different from "we don't know what this cost".
        await finishTolerant({
          status: 'SUCCESS', statusCode: 200, provider: provider.name,
          usage: { promptTokens: 0, completionTokens: 0 },
          upstreamMs: 0, cacheHit: true, streamed: false,
          responseBody: idempotencyKey === null ? null : hit,
        });
        return reply.code(200).send(hit);
      }
      reply.header('x-conduit-cache', 'MISS');
    }

    // ---- 6. upstream -----------------------------------------------------
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deps.upstreamTimeoutMs);
    // Client disconnect must cancel the upstream call, or the gateway keeps
    // paying for tokens nobody will ever read.
    request.raw.on('close', () => { if (!reply.sent) controller.abort(); });

    const upstreamStart = performance.now();

    try {
      if (body.stream === true) {
        return await streamResponse(reply, provider, completion, controller.signal,
          upstreamStart, finish, requestId);
      }

      const result = await provider.complete(completion, controller.signal);
      const upstreamMs = Math.round(performance.now() - upstreamStart);
      await cache.set(ctx, completion, result);

      const outcome = await finishTolerant({
        status: 'SUCCESS', statusCode: 200, provider: provider.name,
        usage: result.usage, upstreamMs, cacheHit: false, streamed: false,
        responseBody: idempotencyKey === null ? null : result,
      });

      if (outcome === 'duplicate' && idempotencyKey !== null) {
        // Lost the race: a concurrent identical request already committed.
        // Return ITS response so both callers see the same bytes.
        const winner = await findReplay(deps.db, ctx.orgId, idempotencyKey);
        if (winner !== null) {
          reply.header('x-conduit-idempotent-replay', 'true');
          return reply.code(winner.statusCode).send(winner.responseBody);
        }
      }
      return reply.code(200).send(result);
    } catch (err) {
      const upstreamMs = Math.round(performance.now() - upstreamStart);
      const isProviderErr = err instanceof ProviderError;
      const aborted = controller.signal.aborted;

      const status: RequestStatus = aborted ? 'TIMEOUT'
        : isProviderErr && (err.statusCode ?? 500) < 500 ? 'CLIENT_ERROR'
        : 'UPSTREAM_ERROR';
      const statusCode = aborted ? 504 : isProviderErr ? (err.statusCode ?? 502) : 502;

      request.log.error({ err, provider: provider.name }, 'upstream failed');
      await finishTolerant({
        status, statusCode, provider: provider.name,
        usage: null, upstreamMs, cacheHit: false, streamed: body.stream === true,
        errorCode: isProviderErr ? 'provider_error' : 'internal_error',
        errorMessage: err instanceof Error ? err.message : 'unknown',
      });
      return reply.code(statusCode).send(
        apiError('api_error', 'Upstream provider request failed', requestId));
    } finally {
      clearTimeout(timeout);
    }
  });
}

/**
 * Server-Sent Events passthrough.
 *
 * The response is committed the moment the first byte is written, so an error
 * after that point CANNOT become a 502 — the status line is already gone. The
 * only honest thing to do is emit an error event and close the stream, and
 * still write the ledger row with whatever usage was observed.
 */
async function streamResponse(
  reply: FastifyReply,
  provider: { name: string; stream: (r: CompletionRequest, s: AbortSignal) => AsyncIterable<{ delta: string; done: boolean; usage?: TokenUsage | null }> },
  completion: CompletionRequest,
  signal: AbortSignal,
  upstreamStart: number,
  finish: (a: {
    status: RequestStatus; statusCode: number; provider: string;
    usage: TokenUsage | null; upstreamMs: number | null;
    cacheHit: boolean; streamed: boolean; errorCode?: string; errorMessage?: string;
  }) => Promise<void>,
  requestId: string,
): Promise<void> {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-conduit-cache': 'BYPASS',
  });

  let usage: TokenUsage | null = null;
  let chunks = 0;

  try {
    for await (const chunk of provider.stream(completion, signal)) {
      chunks += 1;
      if (chunk.usage !== undefined && chunk.usage !== null) usage = chunk.usage;
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
    await finish({
      status: 'SUCCESS', statusCode: 200, provider: provider.name,
      usage, upstreamMs: Math.round(performance.now() - upstreamStart),
      cacheHit: false, streamed: true,
    });
  } catch (err) {
    // Partial stream. usage stays null unless the provider already sent it,
    // which is precisely the "cost unknown" case the schema models.
    reply.raw.write(`event: error\ndata: ${JSON.stringify({
      error: { type: 'api_error', message: 'Stream interrupted', requestId },
    })}\n\n`);
    reply.raw.end();
    await finish({
      status: signal.aborted ? 'CANCELLED' : 'UPSTREAM_ERROR',
      statusCode: 200, provider: provider.name,
      usage, upstreamMs: Math.round(performance.now() - upstreamStart),
      cacheHit: false, streamed: true,
      errorCode: 'stream_interrupted',
      errorMessage: `interrupted after ${chunks} chunk(s)`,
    });
  }
}