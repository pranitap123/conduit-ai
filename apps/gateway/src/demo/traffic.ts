/**
 * Synthetic traffic generator.
 *
 * THE PROBLEM IT SOLVES: a deployed dashboard with no traffic is an empty
 * dashboard, and an empty dashboard demonstrates nothing.
 *
 * THE RULE IT OBEYS: every number on the dashboard must have been produced by
 * the real request path. This does not insert rows into `requests`. It sends
 * HTTP requests to the running gateway with a real API key, and those requests
 * go through authentication, rate limiting, caching, the provider and the
 * ledger exactly like any other. Cache hits are real cache hits. Rate-limit
 * rows exist because the limiter actually refused them.
 *
 * The only fiction is the mock provider's content and its synthetic prices,
 * both of which are labelled as such.
 */
import { setTimeout as sleep } from 'node:timers/promises';

export interface TrafficOptions {
  baseUrl: string;
  apiKey: string;
  /** Total requests to send. */
  count: number;
  /** Parallel senders. Higher values exercise the rate limiter. */
  concurrency: number;
  /** Pause between requests per sender, milliseconds. */
  delayMs: number;
}

export interface TrafficSummary {
  sent: number;
  byStatus: Record<number, number>;
  cacheHits: number;
  streamed: number;
  durationMs: number;
}

/**
 * A weighted mix, tuned so the dashboard shows every state it can render.
 * `mock-fail-*` and `mock-slow` exist in the provider precisely so error and
 * timeout paths can be demonstrated without breaking anything real.
 */
const MODELS: Array<{ model: string; weight: number; stream?: boolean }> = [
  { model: 'mock-small', weight: 55 },
  { model: 'mock-large', weight: 20 },
  { model: 'mock-small', weight: 12, stream: true },
  { model: 'mock-unpriced', weight: 5 },
  { model: 'mock-fail-retryable', weight: 5 },
  { model: 'mock-fail-permanent', weight: 3 },
];

// A small pool: repeats produce genuine cache hits on temperature-0 requests.
const PROMPTS = [
  'Summarise this support ticket in one sentence.',
  'Classify the sentiment of this review.',
  'Extract the invoice total from this text.',
  'Rewrite this paragraph for a technical audience.',
  'What are the trade-offs of optimistic locking?',
  'Generate a commit message for this diff.',
];

function pickModel(): { model: string; stream: boolean } {
  const total = MODELS.reduce((n, m) => n + m.weight, 0);
  let roll = Math.random() * total;
  for (const m of MODELS) {
    roll -= m.weight;
    if (roll <= 0) return { model: m.model, stream: m.stream ?? false };
  }
  return { model: 'mock-small', stream: false };
}

export async function generateTraffic(opts: TrafficOptions): Promise<TrafficSummary> {
  const started = Date.now();
  const summary: TrafficSummary = {
    sent: 0, byStatus: {}, cacheHits: 0, streamed: 0, durationMs: 0,
  };

  const perWorker = Math.ceil(opts.count / opts.concurrency);

  const worker = async (): Promise<void> => {
    for (let i = 0; i < perWorker && summary.sent < opts.count; i += 1) {
      const { model, stream } = pickModel();
      const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)]!;
      // A third of requests are temperature 0, so the cache is genuinely
      // exercised rather than always bypassed.
      const temperature = Math.random() < 0.35 ? 0 : 0.7;

      try {
        const res = await fetch(`${opts.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            stream,
          }),
        });

        summary.sent += 1;
        summary.byStatus[res.status] = (summary.byStatus[res.status] ?? 0) + 1;
        if (res.headers.get('x-conduit-cache') === 'HIT') summary.cacheHits += 1;
        if (stream) summary.streamed += 1;

        // The body must be consumed or the socket is not released back to the
        // pool, and the generator slowly runs out of connections.
        await res.text();
      } catch {
        summary.sent += 1;
        summary.byStatus[0] = (summary.byStatus[0] ?? 0) + 1;
      }

      if (opts.delayMs > 0) await sleep(opts.delayMs);
    }
  };

  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  summary.durationMs = Date.now() - started;
  return summary;
}