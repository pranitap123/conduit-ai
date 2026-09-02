import {
  type CompletionRequest,
  type CompletionResult,
  type LLMProvider,
  ProviderError,
  type StreamChunk,
} from './types.js';

/**
 * Mock provider.
 *
 * WHY THIS IS NOT A SHORTCUT: you cannot write a deterministic test against a
 * real LLM. Every integration test for auth, metering, caching, rate limiting
 * and failover needs a provider whose latency, token counts and failure mode
 * are things the test chooses. That provider is this file.
 *
 * It also keeps the repo runnable with zero credentials, which is what lets a
 * recruiter clone it and see it work.
 *
 * Failure injection is by model name so tests and the traffic generator can
 * drive error paths through the real request pipeline rather than mocking
 * around it:
 *   mock-fail-retryable  -> 503, retryable
 *   mock-fail-permanent  -> 400, not retryable
 *   mock-slow            -> sleeps, for timeout and cancellation tests
 */
const LATENCY_MS = 120;
const SLOW_LATENCY_MS = 5_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new ProviderError('request aborted', 'mock', false));
    }, { once: true });
  });
}

export class MockProvider implements LLMProvider {
  readonly name = 'mock';

  supports(model: string): boolean {
    return model.startsWith('mock');
  }

  async complete(req: CompletionRequest, signal: AbortSignal): Promise<CompletionResult> {
    // Varied latency so p50/p95 on the dashboard are meaningful rather than flat.
    const base = req.model === 'mock-slow' ? SLOW_LATENCY_MS
      : req.model === 'mock-large' ? LATENCY_MS * 3
      : LATENCY_MS;
    await sleep(base + Math.random() * base * 0.8, signal);

    if (req.model === 'mock-fail-retryable') {
      throw new ProviderError('mock upstream overloaded', 'mock', true, 503);
    }
    if (req.model === 'mock-fail-permanent') {
      throw new ProviderError('mock invalid request', 'mock', false, 400);
    }

    const prompt = req.messages.map((m) => m.content).join(' ');
    const content = `[mock] echoing ${req.messages.length} message(s)`;

    // Deliberately crude: ~4 chars per token. Real adapters report real usage.
    return {
      content,
      model: req.model,
      usage: {
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(content.length / 4),
      },
      finishReason: 'stop',
    };
  }

  async *stream(req: CompletionRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    if (req.model === 'mock-fail-permanent') {
      throw new ProviderError('mock invalid request', 'mock', false, 400);
    }

    const prompt = req.messages.map((m) => m.content).join(' ');
    const words = `[mock] streamed reply for ${req.messages.length} message(s)`.split(' ');
    let emitted = 0;

    for (const [i, word] of words.entries()) {
      // Abort mid-stream is a first-class case: the client disconnected, or the
      // upstream died. Both surface here as an aborted signal.
      if (signal.aborted) {
        throw new ProviderError('stream aborted', 'mock', false);
      }
      await sleep(20, signal);
      emitted += 1;

      // Simulate an upstream that dies part-way through, so partial-stream
      // usage accounting can actually be tested.
      if (req.model === 'mock-fail-midstream' && i === 2) {
        throw new ProviderError('mock upstream closed mid-stream', 'mock', true, 502);
      }

      yield { delta: i === 0 ? word : ` ${word}`, done: false };
    }

    yield {
      delta: '',
      done: true,
      finishReason: 'stop',
      usage: {
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: emitted,
      },
    };
  }
}
