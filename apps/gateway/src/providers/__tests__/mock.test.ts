import { describe, expect, it } from 'vitest';
import { MockProvider } from '../mock.js';
import { ProviderError } from '../types.js';

describe('MockProvider', () => {
  const provider = new MockProvider();
  const messages = [{ role: 'user' as const, content: 'hello there' }];

  it('claims only mock models', () => {
    expect(provider.supports('mock-small')).toBe(true);
    expect(provider.supports('gpt-4o')).toBe(false);
  });

  it('returns usage the gateway can meter', async () => {
    const result = await provider.complete(
      { model: 'mock-small', messages },
      new AbortController().signal,
    );
    expect(result.usage?.promptTokens).toBeGreaterThan(0);
    expect(result.usage?.completionTokens).toBeGreaterThan(0);
    expect(result.finishReason).toBe('stop');
  });

  it('marks a 503 as retryable and a 400 as not', async () => {
    const signal = new AbortController().signal;

    const retryable = await provider
      .complete({ model: 'mock-fail-retryable', messages }, signal)
      .catch((e: unknown) => e as ProviderError);
    expect(retryable).toBeInstanceOf(ProviderError);
    expect((retryable as ProviderError).retryable).toBe(true);

    const permanent = await provider
      .complete({ model: 'mock-fail-permanent', messages }, signal)
      .catch((e: unknown) => e as ProviderError);
    expect((permanent as ProviderError).retryable).toBe(false);
  });
});
