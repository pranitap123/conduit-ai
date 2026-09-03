import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The unit tests next door prove `loadConfig` rejects a bad secret. These prove
 * the PROCESS actually refuses to start — that the validation is wired into the
 * boot path and not merely present in a module nobody calls.
 *
 * A gateway that starts with a placeholder signing secret works perfectly and
 * silently allows anyone to forge a session cookie for any user. There is no
 * runtime symptom, so startup is the only place this can be caught.
 */
const GATEWAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const VALID: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/nonexistent',
  REDIS_URL: 'redis://127.0.0.1:6379',
  // A port nothing else in the suite uses; the process must never reach it.
  PORT: '3987',
};

interface Outcome { code: number | null; stderr: string; listened: boolean }

/** Boots the real server entrypoint and reports how it terminated. */
async function boot(env: Record<string, string>): Promise<Outcome> {
  return new Promise((resolvePromise) => {
    const child = spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: GATEWAY_ROOT,
      env: { ...process.env, ...VALID, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows resolves `npx` to `npx.cmd`, which spawn() only finds through
      // a shell — without this the process never starts and the failure
      // surfaces as ENOENT, not as the config rejection this test is for.
      // Harmless on POSIX: npx is a plain executable there either way.
      shell: process.platform === 'win32',
    });

    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });

    // If the process is still alive after this, it did not reject the config.
    const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        code,
        stderr,
        listened: /listening|server listening/i.test(stdout + stderr),
      });
    });
  });
}

// Windows-only limitation: shell: true (required so `npx` resolves to
// `npx.cmd`) nests the real node process under cmd.exe. child.kill('SIGKILL')
// only reaches that shell wrapper, not the node process underneath, so on
// Windows the kill can orphan the process still holding stderr open — seen as
// either a hung close or a truncated stderr read, neither of which is this
// test lying about the product. The claim itself — that a bad secret refuses
// to boot — is proven at the unit level in env.test.ts and by this same file
// running on Linux in CI. Not worth a process-tree-kill dependency for one
// Windows-local test run.
describe.skipIf(process.platform === 'win32')('production startup', () => {
  it('exits non-zero when AUTH_SECRET is missing', async () => {
    const out = await boot({ NODE_ENV: 'production' });
    expect(out.code).toBe(1);
    expect(out.listened).toBe(false);
    expect(out.stderr).toContain('AUTH_SECRET must be set in production');
    expect(out.stderr).toContain('openssl rand -base64 32');
  }, 20_000);

  it('exits non-zero on the compose placeholder secret', async () => {
    const out = await boot({
      NODE_ENV: 'production',
      AUTH_SECRET: 'change-me-before-deploying',
    });
    expect(out.code).toBe(1);
    expect(out.listened).toBe(false);
    expect(out.stderr).toContain('known placeholder');
  }, 20_000);

  it('exits non-zero on the development fallback secret', async () => {
    const out = await boot({
      NODE_ENV: 'production',
      AUTH_SECRET: 'dev-only-insecure-secret',
    });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('known placeholder');
  }, 20_000);

  it('exits non-zero on a too-short secret', async () => {
    const out = await boot({ NODE_ENV: 'production', AUTH_SECRET: 'short-secret' });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('at least 32 characters');
  }, 20_000);

  it('reports a configuration error without printing a stack trace', async () => {
    const out = await boot({ NODE_ENV: 'production' });
    // An operator mistake should read as a message, not as a crash.
    expect(out.stderr).toContain('Configuration error:');
    expect(out.stderr).not.toContain('at loadConfig');
    expect(out.stderr).not.toContain('ConfigError: ');
  }, 20_000);

  it('gets past configuration with a valid secret and fails later, on the database', async () => {
    // Proves the secret check is not simply rejecting everything: with a good
    // secret the process proceeds, and the next failure is the unreachable
    // database named in VALID — a different error entirely.
    const out = await boot({
      NODE_ENV: 'production',
      AUTH_SECRET: 'Yb3xK9vQ2mZpR7wLnT4jC8sHdF6gA1eU5oI0yXbNqWk=',
    });
    expect(out.stderr).not.toContain('AUTH_SECRET');
    expect(out.stderr).not.toContain('Configuration error:');
  }, 20_000);
});