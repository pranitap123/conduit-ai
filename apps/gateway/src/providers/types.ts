/**
 * Provider abstraction.
 *
 * WHY THIS EXISTS: the gateway must not be a pile of `if (provider === 'openai')`
 * branches. Every provider speaks a slightly different dialect, but the gateway
 * only cares about four things: send a request, get text back, learn how many
 * tokens it cost, and know whether a failure is worth retrying.
 *
 * WHY THIS SHAPE: the interface is deliberately narrower than any real provider
 * API. It exposes only what the gateway needs to do its job. A wider interface
 * would leak provider-specific concepts into the routing, metering and caching
 * code, and adding a fifth provider would then mean touching all of them.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * Token counts come FROM THE PROVIDER, never from our own estimate, whenever
 * the provider reports them. Estimating tokens locally and billing on that
 * estimate is how metering silently drifts away from the real provider invoice.
 *
 * `usage` is nullable on purpose: some providers omit usage on streamed or
 * errored responses. Nullable forces every caller to decide what to do about
 * a request whose cost is unknown, rather than defaulting it to zero.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface CompletionResult {
  content: string;
  model: string;
  usage: TokenUsage | null;
  finishReason: 'stop' | 'length' | 'content_filter' | 'error';
}

/**
 * Retryability is a PROVIDER concern, not a gateway concern. Only the adapter
 * knows that this provider signals overload with 529 while that one uses 503.
 * The adapter classifies; the retry policy in the gateway just reads the flag.
 *
 * Getting this wrong is expensive in both directions: retrying a 400 wastes
 * time on a request that can never succeed, and refusing to retry a 503 turns
 * a transient blip into a user-visible error.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface LLMProvider {
  readonly name: string;
  supports(model: string): boolean;
  complete(req: CompletionRequest, signal: AbortSignal): Promise<CompletionResult>;
}
