import { afterAll, beforeAll, describe, expect, test } from '@rstest/core';
import { Readable } from 'node:stream';
import { configure } from '../src/configure';
import { Database } from '../src/database';
import { chunk, first, select, step, stream } from '../src/query';
import { bulkWrite, insertIntoTable } from '../src/tables';
import { withSchema } from './helpers';

let db: Database;

beforeAll(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  db = new Database(url);
  configure();
});

afterAll(async () => {
  await db.pool.end();
});

async function createTestTable(db: Database, schema: string) {
  await db.pool.query(`
    CREATE TABLE "${schema}"."items" (
      id serial PRIMARY KEY,
      name varchar(100) NOT NULL,
      value int NOT NULL DEFAULT 0
    )
  `);
}

describe('transactions', () => {
  test('commits successfully', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(async (tx, { commit }) => {
        const client = await tx.pool.connect();
        await client.query(`INSERT INTO "${schema}"."items" (name, value) VALUES ('a', 1)`);
        await commit();
      }, { autoCommit: false });

      const result = await db.pool.query(`SELECT * FROM "${schema}"."items"`);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('a');
      expect(result.rows[0].value).toBe(1);
    });
  });

  test('rolls back explicitly', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(async (tx, { rollback }) => {
        const client = await tx.pool.connect();
        await client.query(`INSERT INTO "${schema}"."items" (name, value) VALUES ('b', 2)`);
        await rollback();
      }, { autoCommit: false });

      const result = await db.pool.query(`SELECT * FROM "${schema}"."items"`);
      expect(result.rows).toHaveLength(0);
    });
  });

  test('double commit is silent (no-op)', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(async (tx, { commit }) => {
        const client = await tx.pool.connect();
        await client.query(`INSERT INTO "${schema}"."items" (name, value) VALUES ('a', 1)`);
        await commit();
        await commit(); // second call must not throw
      }, { autoCommit: false });

      // First commit persisted the row
      const result = await db.pool.query(`SELECT * FROM "${schema}"."items"`);
      expect(result.rows).toHaveLength(1);
    });
  });

  test('double rollback is silent (no-op)', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(async (tx, { rollback }) => {
        const client = await tx.pool.connect();
        await client.query(`INSERT INTO "${schema}"."items" (name, value) VALUES ('b', 2)`);
        await rollback();
        await rollback(); // second call must not throw
      }, { autoCommit: false });

      // Rollback discarded the row
      const result = await db.pool.query(`SELECT * FROM "${schema}"."items"`);
      expect(result.rows).toHaveLength(0);
    });
  });

  test('nested transaction throws', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await expect(
        db.transaction(async (tx) => {
          // biome-ignore lint/suspicious/noExplicitAny: accessing transaction proxy to test nested throw
          await (tx as any).transaction(async () => {});
        }),
      ).rejects.toThrow('Cannot initiate nested transaction');
    });
  });
});

describe('query modes', () => {
  test('select returns all rows', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);
      await db.pool.query(`
        INSERT INTO "${schema}"."items" (name, value) VALUES
          ('alpha', 10), ('beta', 20), ('gamma', 30), ('delta', 40), ('epsilon', 50)
      `);

      const client = await db.pool.connect();
      try {
        const rows = await select(client, `SELECT * FROM "${schema}"."items" ORDER BY id`);
        expect(rows).toHaveLength(5);
        expect((rows[0] as { name: string }).name).toBe('alpha');
      } finally {
        client.release();
      }
    });
  });

  test('first returns single row', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);
      await db.pool.query(`
        INSERT INTO "${schema}"."items" (name, value) VALUES
          ('alpha', 10), ('beta', 20), ('gamma', 30), ('delta', 40), ('epsilon', 50)
      `);

      const client = await db.pool.connect();
      try {
        const row = await first(client, `SELECT * FROM "${schema}"."items" WHERE name = 'gamma'`);
        expect(row).toBeDefined();
        expect((row as { name: string; value: number }).name).toBe('gamma');
        expect((row as { name: string; value: number }).value).toBe(30);
      } finally {
        client.release();
      }
    });
  });

  test('first returns undefined for no match', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);
      await db.pool.query(`
        INSERT INTO "${schema}"."items" (name, value) VALUES
          ('alpha', 10), ('beta', 20), ('gamma', 30), ('delta', 40), ('epsilon', 50)
      `);

      const client = await db.pool.connect();
      try {
        const row = await first(client, `SELECT * FROM "${schema}"."items" WHERE name = 'nonexistent'`);
        expect(row).toBeUndefined();
      } finally {
        client.release();
      }
    });
  });

  test('stream returns readable stream of rows', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);
      await db.pool.query(`
        INSERT INTO "${schema}"."items" (name, value) VALUES
          ('alpha', 10), ('beta', 20), ('gamma', 30), ('delta', 40), ('epsilon', 50)
      `);

      const client = await db.pool.connect();
      try {
        const readable = stream(client, `SELECT * FROM "${schema}"."items" ORDER BY id`);
        expect(readable).toBeInstanceOf(Readable);

        const collected: unknown[] = [];
        for await (const row of readable) {
          collected.push(row);
        }

        expect(collected).toHaveLength(5);
        expect((collected[0] as { name: string }).name).toBe('alpha');
      } finally {
        client.release();
      }
    });
  });

  test('chunk processes rows in batches', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);
      await db.pool.query(`
        INSERT INTO "${schema}"."items" (name, value) VALUES
          ('alpha', 10), ('beta', 20), ('gamma', 30), ('delta', 40), ('epsilon', 50)
      `);

      const client = await db.pool.connect();
      try {
        const batches: unknown[][] = [];
        await chunk(
          client,
          `SELECT * FROM "${schema}"."items" ORDER BY id`,
          (rows) => {
            batches.push(rows);
          },
          { size: 2 },
        );
        expect(batches).toHaveLength(3);
        expect(batches[0]).toHaveLength(2);
        expect(batches[2]).toHaveLength(1);
      } finally {
        client.release();
      }
    });
  });

  test('step processes rows one at a time', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);
      await db.pool.query(`
        INSERT INTO "${schema}"."items" (name, value) VALUES
          ('alpha', 10), ('beta', 20), ('gamma', 30), ('delta', 40), ('epsilon', 50)
      `);

      const client = await db.pool.connect();
      try {
        const stepped: unknown[] = [];
        await step(client, `SELECT * FROM "${schema}"."items" ORDER BY id`, (row) => {
          stepped.push(row);
        });
        expect(stepped).toHaveLength(5);
        expect((stepped[0] as { name: string }).name).toBe('alpha');
      } finally {
        client.release();
      }
    });
  });

  test('chunk closes cursor when callback throws', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);
      await db.pool.query(`INSERT INTO "${schema}"."items" (name, value) VALUES ('x', 1)`);

      const client = await db.pool.connect();
      try {
        await expect(
          chunk(client, `SELECT * FROM "${schema}"."items"`, async () => {
            throw new Error('callback error');
          }),
        ).rejects.toThrow('callback error');

        // If cursor leaked, subsequent queries on the same client would hang or error.
        const rows = await select(client, 'SELECT 1 AS alive');
        expect((rows[0] as { alive: number }).alive).toBe(1);
      } finally {
        client.release();
      }
    });
  });
});

describe('bulk operations', () => {
  test('insertIntoTable inserts multiple rows', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      const client = await db.pool.connect();
      try {
        const result = await insertIntoTable(
          client,
          { schema, name: 'items' },
          [
            { name: 'x', value: 1 },
            { name: 'y', value: 2 },
            { name: 'z', value: 3 },
          ],
          { full: true },
        );
        expect(result).toHaveLength(3);
        expect((result[0] as { name: string }).name).toBe('x');
        expect((result[1] as { name: string }).name).toBe('y');
        expect((result[2] as { name: string }).name).toBe('z');
      } finally {
        client.release();
      }
    });
  });

  test('bulkWrite inserts rows via COPY protocol', async () => {
    await withSchema(db, async (schema) => {
      await db.pool.query(`
        CREATE TABLE "${schema}"."bulk_items" (
          name varchar(100) NOT NULL,
          value int NOT NULL
        )
      `);

      const client = await db.pool.connect();
      try {
        const { enqueue, close } = bulkWrite(client, { schema, name: 'bulk_items' });
        enqueue({ name: 'a', value: 1 });
        enqueue({ name: 'b', value: 2 });
        enqueue({ name: 'c', value: 3 });
        await close();

        const result = await db.pool.query(`SELECT * FROM "${schema}"."bulk_items" ORDER BY name`);
        expect(result.rows).toHaveLength(3);
        expect(result.rows[0].name).toBe('a');
        expect(result.rows[1].name).toBe('b');
        expect(result.rows[2].name).toBe('c');
      } finally {
        client.release();
      }
    });
  });
});
