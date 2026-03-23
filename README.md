# oopg

Type-safe, ergonomic PostgreSQL client for TypeScript

[![npm](https://img.shields.io/npm/v/@lalex/oopg)](https://www.npmjs.com/package/@lalex/oopg)

## Installation

```bash
pnpm add @lalex/oopg
# or
npm install @lalex/oopg
# or
yarn add @lalex/oopg
```

## Quick Start

```typescript
import { Database } from '@lalex/oopg';

const db = new Database('postgresql://user:pass@localhost/mydb');

// Select multiple rows
const users = await db.select<{ id: string; name: string }>(
  'SELECT id, name FROM users WHERE active = $1',
  [true],
);

// Execute a non-SELECT statement
const result = await db.execute(
  'UPDATE users SET last_seen = NOW() WHERE id = $1',
  [userId],
);
console.log(`updated ${result.count} row(s)`);

// Always end the pool when your process exits
await db.pool.end();
```

## Schema Definition

Define your database schema by extending `Database` and declaring tables, views, and functions using `this.table()`, `this.view()`, and `this.func()`. TypeScript infers row types from column definitions.

```typescript
import {
  Database,
  createTable,
  varchar,
  decimal,
  datetime,
  required,
  type InputType,
  type OutputType,
} from '@lalex/oopg';
import type { ClientBase } from 'pg';

// Column definitions drive TypeScript inference
const productColumns = {
  name:      required(varchar(255)),   // NOT NULL VARCHAR(255)
  sku:       required(varchar(64)),    // NOT NULL VARCHAR(64)
  price:     required(decimal(10, 2)), // NOT NULL DECIMAL(10,2)
  createdAt: datetime(),               // TIMESTAMPTZ, auto-populated
};

// Derive TypeScript types from the schema
type ProductInput  = InputType<typeof productColumns>;  // { name: string; sku: string; price: number; }
type ProductOutput = OutputType<typeof productColumns>; // { id: string; name: string; sku: string; price: number; createdAt: Date; }

// Create the table in PostgreSQL
async function migrate(client: ClientBase) {
  await createTable(client, 'products', productColumns, {
    indexes: [{ on: 'sku', unique: true }],
  });
}

// Subclass Database to attach typed entity references
class AppDB extends Database {
  products = this.table<ProductOutput>('products');
}

const db = new AppDB('postgresql://localhost/mydb');
const rows = await db.products.find({});
```

## Query Modes

### `select` — return all matching rows

```typescript
const users = await db.select<{ id: string; email: string }>(
  'SELECT id, email FROM users WHERE active = $1',
  [true],
);
// users: Array<{ id: string; email: string }>
```

### `first` — return the first row, or `undefined`

```typescript
const user = await db.first<{ id: string; name: string }>(
  'SELECT id, name FROM users WHERE email = $1',
  ['alice@example.com'],
);
if (user) {
  console.log('found:', user.name);
}
```

### `select` with streaming — return a `Readable` stream

Use `{ stream: true }` to receive results as an object-mode Node.js stream. Useful for large result sets where you want to pipe to a writable destination.

```typescript
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';

const source = await db.select('SELECT id, name FROM users', [], { stream: true });

const toNdjson = new Transform({
  objectMode: true,
  transform(row, _enc, cb) { cb(null, JSON.stringify(row) + '\n'); },
});

await pipeline(source, toNdjson, createWriteStream('users.ndjson'));
```

### `chunks` — process results in batches

`db.chunks()` uses a server-side cursor to read rows in fixed-size batches. The callback receives each batch and can be async.

```typescript
await db.chunks<{ id: string; email: string }>(
  'SELECT id, email FROM users',
  async (rows) => {
    await sendBulkEmail(rows);
  },
  { size: 500 }, // rows per batch, default: 1000
);
```

### `step` — process results one row at a time

```typescript
await db.step<{ id: string; name: string }>(
  'SELECT id, name FROM large_table',
  async (row) => {
    await processRow(row);
  },
);
```

## Transactions

Use `db.transaction()` to run a set of queries inside a `BEGIN`/`COMMIT` block. The callback receives a transaction-scoped client (`tx`) and explicit `commit`/`rollback` functions. If the callback throws without calling either, the transaction is rolled back automatically.

```typescript
const newUserId = await db.transaction(async (tx, { commit, rollback }) => {
  const [user] = await tx.select<{ id: string }>(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id',
    ['Alice', 'alice@example.com'],
  );

  if (!user) {
    await rollback();
    return null;
  }

  await tx.execute(
    'INSERT INTO audit_log (action, target_id) VALUES ($1, $2)',
    ['user_created', user.id],
  );

  await commit();
  return user.id;
});
```

## Bulk Operations

Use `db.connect()` to acquire a raw `pg` client for operations that require direct client access.

### `insertIntoTable` — multi-row INSERT

```typescript
import { insertIntoTable } from '@lalex/oopg';

const ids = await db.connect(async (client) => {
  return insertIntoTable(client, 'products', [
    { name: 'Widget A', sku: 'WGT-001', price: 9.99 },
    { name: 'Widget B', sku: 'WGT-002', price: 14.99 },
    { name: 'Widget C', sku: 'WGT-003', price: 4.99 },
  ]);
});
console.log('inserted ids:', ids);
```

### `bulkWrite` — PostgreSQL COPY protocol

For very large data sets, the COPY protocol is significantly faster than multi-row INSERT. `bulkWrite` returns `{ enqueue, close }` — push rows with `enqueue` and call `close()` when finished.

```typescript
import { bulkWrite } from '@lalex/oopg';
import { createReadStream } from 'node:fs';

await db.connect(async (client) => {
  const { enqueue, close } = bulkWrite(client, 'products');

  for (const row of largeDataset) {
    enqueue(row);
  }

  await close();
});
```

## LISTEN/NOTIFY

`oopg` wraps PostgreSQL's LISTEN/NOTIFY mechanism. The first listener on a channel automatically issues `LISTEN <channel>` on a dedicated connection; the last removal issues `UNLISTEN`.

```typescript
import { Database } from '@lalex/oopg';

const db = new Database(process.env.DATABASE_URL!);

// Subscribe to a channel
db.on('order_placed', (payload) => {
  const order = JSON.parse(payload);
  console.log('new order:', order.id);
});

// Publish a notification from another connection
await db.emit('order_placed', JSON.stringify({ id: 42 }));
```

## Type Parser Configuration

By default, `oopg` parses `INT8`, `INT4`, and `NUMERIC` columns as JavaScript numbers. Override the type parsers per pool instance using the `types` constructor option. This does **not** affect other pools or the global `pg` type registry.

```typescript
import { Database } from '@lalex/oopg';

const db = new Database(process.env.DATABASE_URL!, {
  types: {
    // Return BigInt for INT8 (BIGINT) columns instead of number
    INT8: (val) => BigInt(val),
  },
});

const [row] = await db.select<{ big_count: bigint }>(
  'SELECT COUNT(*) AS big_count FROM events',
);
console.log(typeof row.big_count); // 'bigint'
```

## API<DB> Repository Pattern

Extend the `API<DB>` abstract class to build typed repository or service objects that share a single database connection. The `this.db` property is typed to your `Database` subclass.

```typescript
import { API, Database } from '@lalex/oopg';

class AppDB extends Database {
  users = this.table<{ id: string; email: string; name: string }>('users');
}

class UserAPI extends API<AppDB> {
  async findByEmail(email: string) {
    return this.db.first<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM users WHERE email = $1',
      [email],
    );
  }

  async deactivateOldUsers(cutoff: Date) {
    return this.db.execute(
      'UPDATE users SET active = false WHERE last_login < $1',
      [cutoff],
    );
  }
}

const db  = new AppDB(process.env.DATABASE_URL!);
const api = new UserAPI(db);

const user = await api.findByEmail('alice@example.com');
```

## TypeScript Requirements

- **TypeScript 5.x** with `strict: true` enabled in `tsconfig.json`
- **Node.js 18+** — the library uses private class fields and other ES2022 features
- **ESM only** — consumers must have `"type": "module"` in their `package.json`, or use `.mts` file extensions

```json
// tsconfig.json (minimum)
{
  "compilerOptions": {
    "strict": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```

```json
// package.json (consumer)
{
  "type": "module"
}
```
