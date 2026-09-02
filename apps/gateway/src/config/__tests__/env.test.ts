import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, validateAuthSecret, type EnvSource } from '../env.js';

/**
 * Configuration validation is a security control, so it is tested like one.
 *
 * The specific risk: the compose file and the docs both once carried a
 * placeholder AUTH_SECRET. Session tokens are HMAC-signed with this value, so a
 * deployment running a publicly known secret lets anyone forge a session cookie
 * for any user in any organization. That is a full authentication bypass, and
 * it would be invisible — everything works normally.
 */
const BASE: EnvSource = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

const prod = (extra: EnvSource = {}): EnvSource =>
  ({ ...BASE, NODE_ENV: 'production', ...extra });

/** 44 chars, what `openssl rand -base64 32` produces. */
const GOOD_SECRET = 'Yb3xK9vQ2mZpR7wLnT4jC8sHdF6gA1eU5oI0yXbNqWk=';

describe('required variables', () => {
  it('refuses to load without DATABASE_URL', () => {
    expect(() => loadConfig({ REDIS_URL: 'redis://x' })).toThrow(ConfigError);
  });

  it('refuses to load without REDIS_URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://x' })).toThrow(ConfigError);
  });

  it('treats a whitespace-only value as missing', () => {
    expect(() => loadConfig({ ...BASE, DATABASE_URL: '   ' })).toThrow(/DATABASE_URL/);
  });
});

describe('AUTH_SECRET in production', () => {
  it('fails to start when AUTH_SECRET is missing', () => {
    expect(() => loadConfig(prod())).toThrow(ConfigError);
    expect(() => loadConfig(prod())).toThrow(/AUTH_SECRET must be set in production/);
  });

  it('fails to start when AUTH_SECRET is empty or whitespace', () => {
    expect(() => loadConfig(prod({ AUTH_SECRET: '' }))).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig(prod({ AUTH_SECRET: '    ' }))).toThrow(/AUTH_SECRET/);
  });

  it('fails to start on the compose placeholder', () => {
    expect(() => loadConfig(prod({ AUTH_SECRET: 'change-me-before-deploying' })))
      .toThrow(/known placeholder/);
  });

  it('fails to start on the development fallback value', () => {
    // The dev default must never work in production, or the fallback silently
    // becomes the production secret whenever AUTH_SECRET is forgotten.
    expect(() => loadConfig(prod({ AUTH_SECRET: 'dev-only-insecure-secret' })))
      .toThrow(/known placeholder/);
  });

  it('matches placeholders regardless of case or surrounding whitespace', () => {
    for (const value of ['Change-Me-Before-Deploying', '  CHANGEME  ', 'Secret', 'password']) {
      expect(() => loadConfig(prod({ AUTH_SECRET: value })), value).toThrow(/known placeholder/);
    }
  });

  it('rejects a secret shorter than 32 characters', () => {
    expect(() => loadConfig(prod({ AUTH_SECRET: 'a1B2c3D4e5F6g7H8' })))
      .toThrow(/at least 32 characters/);
  });

  it('rejects a long but non-random secret', () => {
    // Clears the length bar, still guessable. The entropy check catches padding.
    expect(() => loadConfig(prod({ AUTH_SECRET: 'a'.repeat(64) })))
      .toThrow(/fewer than 8 distinct characters/);
    expect(() => loadConfig(prod({ AUTH_SECRET: 'abcabcabcabcabcabcabcabcabcabcabcabc' })))
      .toThrow(/fewer than 8 distinct characters/);
  });

  it('names the offending variable so the failure is actionable', () => {
    try {
      loadConfig(prod());
      throw new Error('expected a ConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).variable).toBe('AUTH_SECRET');
      // The message tells the operator how to fix it, not just what is wrong.
      expect((err as ConfigError).message).toContain('openssl rand -base64 32');
    }
  });

  it('accepts a properly generated secret', () => {
    const config = loadConfig(prod({ AUTH_SECRET: GOOD_SECRET }));
    expect(config.authSecret).toBe(GOOD_SECRET);
    expect(config.isProduction).toBe(true);
  });

  it('never reveals the secret value in an error message', () => {
    const leaky = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    try {
      loadConfig(prod({ AUTH_SECRET: leaky }));
      throw new Error('expected a ConfigError');
    } catch (err) {
      // Startup errors land in logs and crash reports. A rejected secret is
      // still a secret, and a near-miss reveals what the real one looks like.
      expect((err as Error).message).not.toContain(leaky);
    }
  });
});

describe('AUTH_SECRET outside production', () => {
  it('falls back to a labelled development secret', () => {
    // Requiring a generated secret for `npm run dev` would push contributors
    // toward committing a shared one, which is worse than a labelled default.
    expect(loadConfig(BASE).authSecret).toBe('dev-only-insecure-secret');
  });

  it('uses a provided secret without imposing production rules', () => {
    expect(loadConfig({ ...BASE, AUTH_SECRET: 'short' }).authSecret).toBe('short');
  });

  it('applies production rules only when NODE_ENV is exactly "production"', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'staging' })).not.toThrow();
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production' })).toThrow();
  });
});

describe('validateAuthSecret directly', () => {
  it('is the single decision point for both environments', () => {
    expect(validateAuthSecret(undefined, false)).toBe('dev-only-insecure-secret');
    expect(validateAuthSecret(GOOD_SECRET, true)).toBe(GOOD_SECRET);
    expect(() => validateAuthSecret(undefined, true)).toThrow(ConfigError);
  });
});
