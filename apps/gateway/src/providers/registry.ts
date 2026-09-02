import { env } from '../config/env.js';
import { MockProvider } from './mock.js';
import type { LLMProvider } from './types.js';

/**
 * Provider registry.
 *
 * WHY a registry rather than a switch: routing asks "who can serve this model",
 * not "which provider did the caller name". That keeps the gateway free to
 * change which provider serves a model — the basis for failover in V2 — without
 * the client knowing or caring.
 */
const ALL: Record<string, () => LLMProvider> = {
  mock: () => new MockProvider(),
};

export class ProviderRegistry {
  private readonly providers: LLMProvider[];

  constructor(enabled: string[] = [...env.enabledProviders]) {
    this.providers = enabled
      .map((name) => ALL[name])
      .filter((f): f is () => LLMProvider => f !== undefined)
      .map((f) => f());
  }

  resolve(model: string): LLMProvider | null {
    return this.providers.find((p) => p.supports(model)) ?? null;
  }

  get names(): string[] {
    return this.providers.map((p) => p.name);
  }
}
