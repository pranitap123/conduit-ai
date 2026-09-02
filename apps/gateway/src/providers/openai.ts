import {
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type LLMProvider,
  type StreamChunk,
  type TokenUsage,
} from './types.js';

/**
 * OpenAI-compatible adapter.
 *
 * Deliberately written against the /v1/chat/completions wire format rather than
 * the official SDK. Reasons in ADR-006: the format is a de-facto standard that
 * Groq, Together, Fireworks, vLLM and Ollama also speak, so one adapter plus a
 * baseUrl covers many providers; and an SDK that retries internally would hide
 * retries from our own ledger, which is the one thing we must not lose.
 */

interface OpenAIResponse {
  model: string;
  choices: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface OpenAIStreamDelta {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}

function mapFinishReason(reason: string | undefined): CompletionResult['finishReason'] {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'content_filter': return 'content_filter';
    default: return 'stop';
  }
}

/**
 * Retryability classification lives here, not in the gateway, because only the
 * adapter knows this provider's dialect of failure.
 *
 * 408/409/429 and 5xx are transient. 400/401/403/404/422 are not — retrying a
 * malformed request burns latency and money on something that can never
 * succeed. 429 IS retryable upstream, but our own limiter should normally have
 * stopped it earlier; seeing it means the provider account is saturated.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /** Model names this instance claims. Empty means "any non-mock model". */
  models?: string[];
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly baseUrl: string;
  private readonly models: string[];

  constructor(private readonly opts: OpenAIProviderOptions) {
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com/v1';
    this.models = opts.models ?? [];
  }

  supports(model: string): boolean {
    if (model.startsWith('mock')) return false;
    return this.models.length === 0 ? true : this.models.includes(model);
  }

  private body(req: CompletionRequest, stream: boolean): string {
    return JSON.stringify({
      model: req.model,
      messages: req.messages,
      ...(req.maxTokens === undefined ? {} : { max_tokens: req.maxTokens }),
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      ...(stream
        // Ask for usage on the final stream chunk. Without this the provider
        // reports nothing for streamed calls and every stream costs "unknown".
        ? { stream: true, stream_options: { include_usage: true } }
        : {}),
    });
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.opts.apiKey}`,
    };
  }

  async complete(req: CompletionRequest, signal: AbortSignal): Promise<CompletionResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this.headers(), body: this.body(req, false), signal,
    }).catch((err: unknown) => {
      // Network-level failure: DNS, TCP reset, abort. Transient by nature.
      throw new ProviderError(
        err instanceof Error ? err.message : 'network error', this.name, true);
    });

    if (!res.ok) {
      // The upstream body is READ but never forwarded to our client — it can
      // contain the provider account's own org identifiers.
      const detail = await res.text().catch(() => '');
      throw new ProviderError(
        `openai ${res.status}: ${detail.slice(0, 500)}`,
        this.name, isRetryableStatus(res.status), res.status);
    }

    const json = (await res.json()) as OpenAIResponse;
    const usage: TokenUsage | null = json.usage === undefined ? null : {
      promptTokens: json.usage.prompt_tokens,
      completionTokens: json.usage.completion_tokens,
    };

    return {
      content: json.choices[0]?.message?.content ?? '',
      model: json.model,
      // NEVER estimated locally. If the provider did not report usage, the cost
      // is genuinely unknown and the ledger says so.
      usage,
      finishReason: mapFinishReason(json.choices[0]?.finish_reason),
    };
  }

  async *stream(req: CompletionRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this.headers(), body: this.body(req, true), signal,
    }).catch((err: unknown) => {
      throw new ProviderError(
        err instanceof Error ? err.message : 'network error', this.name, true);
    });

    if (!res.ok || res.body === null) {
      const detail = await res.text().catch(() => '');
      throw new ProviderError(
        `openai ${res.status}: ${detail.slice(0, 500)}`,
        this.name, isRetryableStatus(res.status), res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: TokenUsage | null = null;
    let finishReason: CompletionResult['finishReason'] = 'stop';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line. A chunk boundary can split
        // a frame in half, so the tail stays in the buffer until it completes.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (line === undefined) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;

          let parsed: OpenAIStreamDelta;
          try {
            parsed = JSON.parse(payload) as OpenAIStreamDelta;
          } catch {
            continue; // a malformed frame must not kill the stream
          }

          if (parsed.usage != null) {
            usage = {
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
            };
          }
          const choice = parsed.choices?.[0];
          if (choice?.finish_reason != null) {
            finishReason = mapFinishReason(choice.finish_reason);
          }
          const delta = choice?.delta?.content;
          if (delta !== undefined && delta !== '') {
            yield { delta, done: false };
          }
        }
      }
      yield { delta: '', done: true, usage, finishReason };
    } finally {
      // Releasing the reader cancels the underlying HTTP body. Without this, an
      // abandoned stream keeps the socket and the provider's generation alive.
      reader.releaseLock();
    }
  }
}
