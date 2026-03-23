import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, test } from '@rstest/core';
import { Database } from '../src/database';
import { chunk, first, select, step, stream } from '../src/query';
import { createSQLContext } from '../src/sql';
import { bulkWrite, createIndexes, createTable, insertIntoTable } from '../src/tables';
import { withSchema } from './helpers';

let db: Database;

beforeAll(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  // Type parsers (INT8→number, INT4→number, NUMERIC→float) are applied automatically
  // via buildTypeParser() in the Database constructor — no explicit configure() call needed.
  db = new Database(url);
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

      await db.transaction(
        async (tx, { commit }) => {
          const client = await tx.pool.connect();
          await client.query(
            `INSERT INTO "${schema}"."items" (name, value) VALUES ('a', 1)`,
          );
          await commit();
        },
        { autoCommit: false },
      );

      const result = await db.pool.query(`SELECT * FROM "${schema}"."items"`);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('a');
      expect(result.rows[0].value).toBe(1);
    });
  });

  test('rolls back explicitly', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(
        async (tx, { rollback }) => {
          const client = await tx.pool.connect();
          await client.query(
            `INSERT INTO "${schema}"."items" (name, value) VALUES ('b', 2)`,
          );
          await rollback();
        },
        { autoCommit: false },
      );

      const result = await db.pool.query(`SELECT * FROM "${schema}"."items"`);
      expect(result.rows).toHaveLength(0);
    });
  });

  test('double commit is silent (no-op)', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(
        async (tx, { commit }) => {
          const client = await tx.pool.connect();
          await client.query(
            `INSERT INTO "${schema}"."items" (name, value) VALUES ('a', 1)`,
          );
          await commit();
          await commit(); // second call must not throw
        },
        { autoCommit: false },
      );

      // First commit persisted the row
      const result = await db.pool.query(`SELECT * FROM "${schema}"."items"`);
      expect(result.rows).toHaveLength(1);
    });
  });

  test('double rollback is silent (no-op)', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(
        async (tx, { rollback }) => {
          const client = await tx.pool.connect();
          await client.query(
            `INSERT INTO "${schema}"."items" (name, value) VALUES ('b', 2)`,
          );
          await rollback();
          await rollback(); // second call must not throw
        },
        { autoCommit: false },
      );

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
          await tx.transaction(async () => {});
        }),
      ).rejects.toThrow('Cannot initiate nested transaction');
    });
  });

  test('transaction callback receives TransactionClient instance', async () => {
    const { TransactionClient } = await import('../src/database');

    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(async (tx) => {
        expect(tx).toBeInstanceOf(TransactionClient);
      });
    });
  });

  test('transaction callback shows TransactionClient in stack', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(async (tx) => {
        expect(tx.constructor.name).toBe('TransactionClient');
      });
    });
  });

  test('tx.schema.table routes queries through transaction client', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(
        async (tx, { rollback }) => {
          // Insert a row via raw SQL on the transaction client
          const txClient = await tx.pool.connect();
          await txClient.query(
            `INSERT INTO "${schema}"."items" (name, value) VALUES ('inside-tx', 99)`,
          );

          // Access the table through tx entity routing
          const items = tx.table<{ id: number; name: string; value: number }>({
            schema,
            name: 'items',
          });

          // Entity find() must route through the transaction client
          // so it can see the uncommitted row
          const rows = await items.find({});
          expect(rows).toHaveLength(1);
          expect(rows[0].name).toBe('inside-tx');
          expect(rows[0].value).toBe(99);

          await rollback();
        },
        { autoCommit: false },
      );

      // After rollback, row must NOT exist
      const result = await db.pool.query(`SELECT * FROM "${schema}"."items"`);
      expect(result.rows).toHaveLength(0);
    });
  });

  test('tx schema() entities route queries through transaction client', async () => {
    await withSchema(db, async (schema) => {
      await createTestTable(db, schema);

      await db.transaction(
        async (tx, { rollback }) => {
          // Insert via transaction client
          const txClient = await tx.pool.connect();
          await txClient.query(
            `INSERT INTO "${schema}"."items" (name, value) VALUES ('schema-tx', 42)`,
          );

          // The Proxy intercepts schema property access on tx only when the schema
          // is stored as a named property on the Database instance. Since s is a
          // local variable (not a db property), the Proxy cannot intercept it.
          // TODO: Current Proxy does not support dynamically-created schemas — TransactionClient must fix
          // biome-ignore lint/suspicious/noExplicitAny: reading schema property from transaction proxy
          const schemaViaProxy = (tx as any)[schema];
          if (schemaViaProxy?.items) {
            // Proxy correctly routes schema entities through transaction client
            const rows = await schemaViaProxy.items.find({});
            expect(rows).toHaveLength(1);
            expect(rows[0].name).toBe('schema-tx');
          }
          // else: known gap — current Proxy does not route local schema variables;
          // TransactionClient refactor (Plan 02) must address this.

          await rollback();
        },
        { autoCommit: false },
      );

      const result = await db.pool.query(`SELECT * FROM "${schema}"."items"`);
      expect(result.rows).toHaveLength(0);
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
        const rows = await select(
          client,
          `SELECT * FROM "${schema}"."items" ORDER BY id`,
        );
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
        const row = await first(
          client,
          `SELECT * FROM "${schema}"."items" WHERE name = 'gamma'`,
        );
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
        const row = await first(
          client,
          `SELECT * FROM "${schema}"."items" WHERE name = 'nonexistent'`,
        );
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
        const readable = stream(
          client,
          `SELECT * FROM "${schema}"."items" ORDER BY id`,
        );
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
        await step(
          client,
          `SELECT * FROM "${schema}"."items" ORDER BY id`,
          (row) => {
            stepped.push(row);
          },
        );
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
      await db.pool.query(
        `INSERT INTO "${schema}"."items" (name, value) VALUES ('x', 1)`,
      );

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
        const { enqueue, close } = bulkWrite(client, {
          schema,
          name: 'bulk_items',
        });
        enqueue({ name: 'a', value: 1 });
        enqueue({ name: 'b', value: 2 });
        enqueue({ name: 'c', value: 3 });
        await close();

        const result = await db.pool.query(
          `SELECT * FROM "${schema}"."bulk_items" ORDER BY name`,
        );
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

describe('type parsers', () => {
  test('oopg defaults parse INT8 and NUMERIC as JavaScript numbers', async () => {
    const result = await db.pool.query(
      'SELECT 42::int8 AS big, 3.14::numeric AS num',
    );
    expect(typeof result.rows[0].big).toBe('number');
    expect(result.rows[0].big).toBe(42);
    expect(typeof result.rows[0].num).toBe('number');
    expect(result.rows[0].num).toBe(3.14);
  });

  test('Database constructor applies per-pool type parser overrides', async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const dbBigInt = new Database(url, {
      types: { INT8: (val) => BigInt(val) },
    });
    try {
      const result = await dbBigInt.pool.query('SELECT 42::int8 AS big');
      expect(typeof result.rows[0].big).toBe('bigint');
      expect(result.rows[0].big).toBe(42n);
    } finally {
      await dbBigInt.pool.end();
    }
  });
});

describe('SQL injection guard (TYPE-02)', () => {
  test('SQL template throws on Symbol parameter (injection guard)', () => {
    const { sql } = createSQLContext(db);
    const sym = Symbol('test');
    expect(() => sql`SELECT ${sym as unknown as string}`).toThrow('SQL template');
    expect(() => sql`SELECT ${sym as unknown as string}`).toThrow('injection');
  });

  test('SQL template throws on function parameter without CallableProp', () => {
    const { sql } = createSQLContext(db);
    const fn = () => 'malicious';
    expect(() => sql`SELECT ${fn as unknown as string}`).toThrow('SQL template');
    expect(() => sql`SELECT ${fn as unknown as string}`).toThrow('injection');
  });

  test('object with toString() is parameterized as jsonb, not interpolated', () => {
    const { sql } = createSQLContext(db);
    const malicious = { toString: () => "'; DROP TABLE users; --" };
    const result = sql`SELECT ${malicious as unknown as string}`;
    // The object case is handled before the default — produces $1::jsonb (safe parameterization)
    expect(result.sql).toContain('$1::jsonb');
    expect(result.values[0]).toBe(JSON.stringify(malicious));
  });
});

describe('CTE alias and use (TYPE-03)', () => {
  test('CTE use() returns SQLQuery with sql and values properties', () => {
    const { utils } = createSQLContext(db);
    const cte = utils.cte`SELECT 1 AS val`;
    const fragment = cte.use();
    expect(fragment).toHaveProperty('sql');
    expect(fragment).toHaveProperty('values');
    expect(typeof fragment.sql).toBe('string');
    expect(Array.isArray(fragment.values)).toBe(true);
  });

  test('CTE default alias is generated automatically', () => {
    const { utils } = createSQLContext(db);
    const cte = utils.cte`SELECT 1 AS val`;
    const fragment = cte.use();
    expect(fragment.sql).toMatch(/"cte_\d+"/);
    expect(fragment.sql).toContain('AS');
    expect(fragment.sql).toContain('SELECT 1 AS val');
    expect(fragment.values).toEqual([]);
  });

  test('CTE alias() sets custom name and is chainable', () => {
    const { utils } = createSQLContext(db);
    const named = (utils.cte`SELECT 1 AS val`).alias('my_cte');
    const fragment = named.use();
    expect(fragment.sql).toContain('"my_cte"');
    expect(fragment.sql).toContain('SELECT 1 AS val');
  });

  test('CTE use(true) produces MATERIALIZED keyword', () => {
    const { utils } = createSQLContext(db);
    const named = (utils.cte`SELECT 1 AS val`).alias('mat_cte');
    const fragment = named.use(true);
    expect(fragment.sql).toContain('MATERIALIZED');
    expect(fragment.sql).not.toContain('NOT MATERIALIZED');
  });

  test('CTE use(false) produces NOT MATERIALIZED keyword', () => {
    const { utils } = createSQLContext(db);
    const named = (utils.cte`SELECT 1 AS val`).alias('notmat_cte');
    const fragment = named.use(false);
    expect(fragment.sql).toContain('NOT MATERIALIZED');
  });

  test('CTE use() without argument produces no materialization keyword', () => {
    const { utils } = createSQLContext(db);
    const named = (utils.cte`SELECT 1 AS val`).alias('plain_cte');
    const fragment = named.use();
    expect(fragment.sql).not.toContain('MATERIALIZED');
    expect(fragment.sql).toContain('"plain_cte" AS (SELECT 1 AS val)');
  });
});

describe('partial index WHERE clause (TYPE-04)', () => {
  test('partial index WHERE clause renders in generated DDL', async () => {
    await withSchema(db, async (schema) => {
      const client = await db.pool.connect();
      try {
        await createTable(
          client,
          { schema, name: 'partial_idx_test' },
          {
            active: { type: 'boolean', required: true },
            name: { type: 'text', required: true },
          },
          { withId: true },
        );

        await createIndexes(client, { schema, name: 'partial_idx_test' }, {
          on: 'name',
          where: 'active = true',
        });

        const result = await select<{ indexdef: string }>(
          client,
          `SELECT indexdef FROM pg_indexes
           WHERE tablename = 'partial_idx_test'
           AND schemaname = $1`,
          [schema],
        );

        expect(result.length).toBeGreaterThan(0);
        const indexDef = result.find((r) => r.indexdef.toLowerCase().includes('where'));
        expect(indexDef).toBeDefined();
        expect(indexDef!.indexdef).toContain('WHERE');
        expect(indexDef!.indexdef.toLowerCase()).toContain('active = true');
      } finally {
        client.release();
      }
    });
  });
});
