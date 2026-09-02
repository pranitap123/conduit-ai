/**
 * Seeds a demo org, prices the mock models, and drives real traffic through the
 * running gateway. Idempotent: safe to run repeatedly.
 *
 * Usage: npm run seed -w gateway -- --url http://localhost:3000 --count 400
 */
import { db, closeDb } from '../db/client.js';
import { generateApiKey } from '../auth/apiKeys.js';
import { hashPassword } from '../auth/passwords.js';
import { logger } from '../lib/logger.js';
import { migrate } from '../db/migrate.js';
import { generateTraffic } from './traffic.js';

const DEMO_EMAIL = 'demo@tollgate.dev';
const DEMO_PASSWORD = 'demo-password-123';

/**
 * SYNTHETIC prices for the mock provider only.
 *
 * These are invented, because the mock provider is invented. No real provider
 * pricing is shipped in this repo — an operator configures those from the
 * provider's own pricing page, and a wrong number here would silently produce a
 * wrong bill.
 */
const MOCK_PRICING: Array<[string, string, string]> = [
  ['mock-small', '0.15', '0.60'],
  ['mock-large', '3.00', '15.00'],
  ['mock-fail-retryable', '3.00', '15.00'],
  ['mock-fail-permanent', '3.00', '15.00'],
  // 'mock-unpriced' is deliberately absent, so the dashboard has a real
  // example of a request whose cost is genuinely unknown.
];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

async function main(): Promise<void> {
  await migrate();

  for (const [model, input, output] of MOCK_PRICING) {
    const existing = await db.selectFrom('model_pricing').select('id')
      .where('provider', '=', 'mock').where('model', '=', model).executeTakeFirst();
    if (existing === undefined) {
      await db.insertInto('model_pricing').values({
        provider: 'mock', model,
        input_price_per_mtok: input, output_price_per_mtok: output,
      }).execute();
    }
  }

  let user = await db.selectFrom('users').select('id')
    .where('email', '=', DEMO_EMAIL).executeTakeFirst();

  if (user === undefined) {
    user = await db.transaction().execute(async (trx) => {
      const u = await trx.insertInto('users')
        .values({ email: DEMO_EMAIL, password_hash: await hashPassword(DEMO_PASSWORD) })
        .returning('id').executeTakeFirstOrThrow();
      const org = await trx.insertInto('organizations')
        .values({ name: 'Demo Org', slug: `demo-${Date.now().toString(36)}` })
        .returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('memberships')
        .values({ user_id: u.id, org_id: org.id, role: 'OWNER' }).execute();
      await trx.insertInto('projects')
        .values({ org_id: org.id, name: 'Production', slug: 'production' }).execute();
      await trx.insertInto('projects')
        .values({ org_id: org.id, name: 'Staging', slug: 'staging' }).execute();
      return u;
    });
    logger.info({ email: DEMO_EMAIL }, 'demo user created');
  }

  const project = await db.selectFrom('projects')
    .innerJoin('memberships', 'memberships.org_id', 'projects.org_id')
    .select('projects.id')
    .where('memberships.user_id', '=', user.id)
    .orderBy('projects.created_at').executeTakeFirstOrThrow();

  // A fresh key each run: the plaintext is unrecoverable, so it cannot be reused.
  const key = generateApiKey();
  await db.insertInto('api_keys').values({
    project_id: project.id, name: `demo-seed-${new Date().toISOString().slice(0, 16)}`,
    prefix: key.prefix, key_hash: key.keyHash, last4: key.last4,
  }).execute();

  const count = Number(arg('count', '400'));
  const summary = await generateTraffic({
    baseUrl: arg('url', 'http://localhost:3000'),
    apiKey: key.plaintext,
    count,
    concurrency: Number(arg('concurrency', '8')),
    delayMs: Number(arg('delay', '15')),
  });

  logger.info({ summary, login: { email: DEMO_EMAIL, password: DEMO_PASSWORD } },
    'demo traffic generated');
  await closeDb();
}

main().catch((err: unknown) => {
  logger.error({ err }, 'seed failed');
  process.exit(1);
});
