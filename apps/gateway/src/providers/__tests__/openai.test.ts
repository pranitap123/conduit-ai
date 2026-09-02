import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../openai.js';
import { ProviderError, type StreamChunk } from '../types.js';

/**
 * Tested against a local server that speaks the OpenAI wire format.
 *
 * WHY not mock `fetch`: mocking fetch tests that we call fetch, not that we
 * parse a real HTTP response, split SSE frames correctly across chunk
 * boundaries, or classify status codes. A real socket exercises all three.
 */
let upstream: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  upstream = Fastify({ logger: false });

  upstream.post('/v1/chat/completions', async (req, reply) => {
    const body = req.body as { model: string; stream?: boolean };

    if (body.model === 'boom-500') return reply.code(500).send({ error: { message: 'upstream on fire' } });
    if (body.model === 'boom-400') return reply.code(400).send({ error: { message: 'bad request, org_id=acct_SECRET' } });
    if (body.model === 'boom-429') return reply.code(429).send({ error: { message: 'slow down' } });
    if (body.model === 'no-usage') {
      return reply.send({ model: body.model, choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });
    }

    if (body.stream === true) {
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
      // Deliberately write a frame split across two socket writes, to prove the
      // buffering logic reassembles it rather than dropping it.
      reply.raw.write('data: {"choices":[{"delta":{"content":"Hel');
      reply.raw.write('lo"}}]}\n\n');
      reply.raw.write('data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n');
      reply.raw.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":2}}\n\n');
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return reply;
    }

    return reply.send({
      model: body.model,
      choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 2 },
    });
  });

  await upstream.listen({ port: 0, host: '127.0.0.1' });
  const addr = upstream.server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${addr.port}/v1`;
});

afterAll(async () => { await upstream.close(); });

const provider = () => new OpenAIProvider({ apiKey: 'sk-test', baseUrl });
const req = (model: string) => ({ model, messages: [{ role: 'user' as const, content: 'hi' }] });
const signal = () => new AbortController().signal;

describe('model routing', () => {
  it('never claims mock models, so mock stays authoritative for them', () => {
    expect(provider().supports('mock-small')).toBe(false);
    expect(provider().supports('gpt-4o-mini')).toBe(true);
  });

  it('claims only its configured models when an allowlist is given', () => {
    const p = new OpenAIProvider({ apiKey: 'k', baseUrl, models: ['gpt-4o-mini'] });
    expect(p.supports('gpt-4o-mini')).toBe(true);
    expect(p.supports('gpt-4o')).toBe(false);
  });
});

describe('completion', () => {
  it('maps the wire response to provider-reported usage', async () => {
    const r = await provider().complete(req('gpt-4o-mini'), signal());
    expect(r.content).toBe('Hello world');
    expect(r.usage).toEqual({ promptTokens: 11, completionTokens: 2 });
    expect(r.finishReason).toBe('stop');
  });

  it('returns null usage rather than estimating when the provider omits it', async () => {
    const r = await provider().complete(req('no-usage'), signal());
    expect(r.usage).toBeNull();
  });
});

describe('error classification', () => {
  it('marks 5xx and 429 retryable, 4xx not', async () => {
    const grab = async (model: string): Promise<ProviderError> => {
      try {
        await provider().complete(req(model), signal());
        throw new Error(`expected ${model} to reject`);
      } catch (e) {
        return e as ProviderError;
      }
    };

    expect((await grab('boom-500')).retryable).toBe(true);
    expect((await grab('boom-429')).retryable).toBe(true);
    expect((await grab('boom-400')).retryable).toBe(false);
    expect((await grab('boom-400')).statusCode).toBe(400);
  });

  it('captures the upstream detail internally (the route is what withholds it)', async () => {
    let err: ProviderError | null = null;
    try { await provider().complete(req('boom-400'), signal()); }
    catch (e) { err = e as ProviderError; }
    expect(err?.message).toContain('acct_SECRET');
  });

  it('treats an unreachable host as retryable', async () => {
    const dead = new OpenAIProvider({ apiKey: 'k', baseUrl: 'http://127.0.0.1:1/v1' });
    let err: unknown = null;
    try { await dead.complete(req('gpt-4o'), signal()); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(true);
  });
});

describe('streaming', () => {
  it('reassembles a frame split across socket writes', async () => {
    const chunks: StreamChunk[] = [];
    for await (const c of provider().stream(req('gpt-4o-mini'), signal())) chunks.push(c);

    const text = chunks.filter((c) => !c.done).map((c) => c.delta).join('');
    expect(text).toBe('Hello world'); // "Hel" + "lo" were written separately
  });

  it('carries usage on the final chunk only', async () => {
    const chunks: StreamChunk[] = [];
    for await (const c of provider().stream(req('gpt-4o-mini'), signal())) chunks.push(c);

    const last = chunks.at(-1);
    expect(last?.done).toBe(true);
    expect(last?.usage).toEqual({ promptTokens: 11, completionTokens: 2 });
    expect(chunks.slice(0, -1).every((c) => c.usage === undefined)).toBe(true);
  });

  it('throws a classified error before yielding when the upstream rejects', async () => {
    const iterate = async (): Promise<void> => {
      for await (const _ of provider().stream(req('boom-500'), signal())) { /* no-op */ }
    };
    await expect(iterate()).rejects.toThrow(ProviderError);
  });
});
