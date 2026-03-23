import { randomUUID } from 'node:crypto';
import type { Database } from '../src/database';

/**
 * Creates an isolated PostgreSQL schema for a single test, runs the test body,
 * and drops the schema unconditionally in a finally block (per D-06).
 */
export async function withSchema(
  db: Database,
  fn: (schema: string) => Promise<void>,
): Promise<void> {
  const schema = `oopg_test_${randomUUID().replace(/-/g, '_')}`;
  await db.pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    await fn(schema);
  } finally {
    await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
}
