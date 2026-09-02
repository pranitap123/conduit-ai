/**
 * Minimal forward-only SQL migrator.
 *
 * WHY hand-rolled: the whole tool is 40 lines, the migrations are plain SQL a
 * DBA can read, and there is no framework between the schema and the database.
 * Cost: no automatic rollback. Accepted — forward-only migrations with an
 * additive discipline is what most production teams do anyway, because rolling
 * back a migration that already dropped a column does not recover the data.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client.js';
import { logger } from '../lib/logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      // Each migration runs in its own transaction: a failure half-way through
      // leaves the schema untouched rather than partially migrated.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return applied;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  migrate()
    .then((applied) => {
      logger.info({ applied }, applied.length ? 'migrations applied' : 'schema up to date');
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, 'migration failed');
      process.exit(1);
    });
}
