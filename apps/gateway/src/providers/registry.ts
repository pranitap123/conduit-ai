import { env } from '../config/env.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider } from './types.js';

/**
 * Provider registry.
 *
 * WHY a registry rather than a switch: routing asks "who can serve this model",
 * not "which provider did the caller name". That keeps the gateway free to
 * change which provider serves a model — the basis for failover in V2 —
 * without the client knowing or caring.
 *
 * Order matters: the first provider that claims the model wins. Mock is
 * registered first and only claims `mock*`, so a real provider can safely
 * claim everything else.
 */
type Factory = () => LLMProvider | null;

const FACTORIES: Record<string, Factory> = {
  mock: () => new MockProvider(),
  openai: () =>
    env.openaiApiKey === null
      ? null // configured but no credential: skip rather than fail at request time
      : new OpenAIProvider({ apiKey: env.openaiApiKey, ...(env.openaiBaseUrl === null ? {} : { baseUrl: env.openaiBaseUrl }) }),
};

export class ProviderRegistry {
  private readonly providers: LLMProvider[];

  constructor(enabled: string[] = [...env.enabledProviders]) {
    this.providers = enabled
      .map((name) => FACTORIES[name]?.() ?? null)
      .filter((p): p is LLMProvider => p !== null);
  }

  resolve(model: string): LLMProvider | null {
    return this.providers.find((p) => p.supports(model)) ?? null;
  }

  get names(): string[] {
    return this.providers.map((p) => p.name);
  }
}
