import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { env } from '../config/env.js';
import type { DB } from './types.js';

/**
 * WHY node-postgres parses NUMERIC as a string by default and we leave it that
 * way: JavaScript numbers are IEEE-754 doubles and cannot represent 0.0000012
 * exactly. Letting pg coerce money to a float would silently corrupt every
 * cost total. Decimal parsing happens deliberately, in the cost engine.
 */
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  // A gateway fans many concurrent requests into the database. An unbounded
  // pool exhausts Postgres connections; too small a pool serialises the app.
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});

export async function closeDb(): Promise<void> {
  await db.destroy();
}
