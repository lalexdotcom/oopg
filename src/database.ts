const LL = L.scope('oopg/database');

import type { Readable, Writable } from 'node:stream';
import { L } from '@lalex/console';
import EventEmitter from 'eventemitter3';
import {
  type ClientBase,
  type ClientConfig,
  type CustomTypesConfig,
  type FieldDef,
  Pool,
  type PoolClient,
  type PoolConfig,
  types as pgTypes,
} from 'pg';

// builtinsTypes is defined in pg-types (transitive dep). Derive the string union
// from the runtime builtins object so we don't need pg-types as a direct dep.
type BuiltinsTypes = keyof typeof pgTypes.builtins;

import type Cursor from 'pg-cursor';
import { DEFAULT_POSTGRES_SCHEMA } from './const';
import {
  type ChunkCallback,
  type ChunksOptions,
  type CursorOptions,
  chunk,
  cursor,
  execute,
  first,
  type SelectOptions,
  type StepCallback,
  type StepOptions,
  select,
  step,
  stream,
} from './query';
import { createSQLContext, type SQLTemplate } from './sql';
import {
  type AddForeignKeyOptions,
  type AlterColumnOptions,
  addForeignKey,
  alterColumn,
  type BulkWriteOptions,
  bulkWrite,
  type CreateTableColumns,
  type CreateTableOptions,
  type CreateTableWriteStreamOptions,
  createIndexes,
  createTable,
  createTableObjectStream,
  getAllTables,
  getAllViews,
  type TableOutputOptions,
  tableExists,
  tableOutput,
  viewExists,
} from './tables';
import type {
  AutoColumns,
  EntityDescription,
  OperationOptions,
  OutputType,
  PGType,
  Row,
  RowWithId,
} from './types';
import {
  clientQuery,
  columnTypeToSQL,
  descriptionToEntity,
  parseConnectionString,
} from './utils';

type TransactionOptions = OperationOptions & { autoCommit?: boolean };

type SQLQuery<DB extends Database, STRICT extends boolean = false> = (
  sql: SQLTemplate,
  tables: ReturnType<typeof createSQLContext<DB, STRICT>>['tables'],
  utils: ReturnType<typeof createSQLContext<DB, STRICT>>['utils'],
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
) => { sql: string; values: any[] };

type ExecuteResult<R extends Row> = {
  command: string;
  count: number | null;
  rows: R[];
  fields: FieldDef[];
};

/** Record of named database elements (tables, views, functions) that make up a schema. */
export type Schema = Record<string, DatabaseElement>;

/**
 * Callback that receives schema-building utilities (`table`, `view`, `func`) and
 * returns a schema definition object.
 */
export type SchemaBuilder<DB extends Database, S extends Schema> = (utils: {
  table: DB['table'];
  view: DB['view'];
  func: DB['func'];
}) => S;

const OOPG_TYPE_DEFAULTS: Partial<
  Record<BuiltinsTypes, (val: string) => unknown>
> = {
  INT8: (val) => Number.parseInt(val, 10),
  INT4: (val) => Number.parseInt(val, 10),
  NUMERIC: (val) => Number.parseFloat(val),
};

function buildTypeParser(
  overrides?: Partial<Record<BuiltinsTypes, (val: string) => unknown>>,
): CustomTypesConfig {
  const merged = { ...OOPG_TYPE_DEFAULTS, ...overrides };
  return {
    getTypeParser: (id, format) => {
      const name = (
        Object.entries(pgTypes.builtins) as [BuiltinsTypes, number][]
      ).find(([, oid]) => oid === id)?.[0];
      if (name && name in merged) {
        return merged[name]!;
      }
      return pgTypes.getTypeParser(id, format ?? 'text');
    },
  };
}

let ClientID = 0;

const SCHEMA_PROPERTY = Symbol('DATABASE_SCHEMA');

type DatabaseSelectOptions = SelectOptions;

// export const isSchema = (o: Record<string, any>): o is Schema => {
//     return o.hasOwnProperty(SCHEMA_PROPERTY);
// };

/**
 * Central database access object. Wraps a `pg.Pool` and provides typed query
 * methods, transaction management, schema-aware SQL templates, and LISTEN/NOTIFY support.
 *
 * @example
 * ```ts
 * import { Database } from 'oopg';
 *
 * const db = new Database('postgresql://user:pass@localhost/mydb');
 *
 * const rows = await db.select<{ id: string; name: string }>(
 *   'SELECT id, name FROM users WHERE active = $1',
 *   [true],
 * );
 * ```
 */
export class Database implements EventEmitter {
  #config: Readonly<PoolConfig>;
  #typeOverrides?: Partial<Record<BuiltinsTypes, (val: string) => unknown>>;
  pool: Pool;
  #acquired = new Map<ClientBase, number>();

  protected static DEFAULT_SCHEMA: string | undefined = undefined;

  eventEmitter = new EventEmitter();
  listenerClient?: Promise<PoolClient>;

  static isSchema(o: unknown): o is Schema {
    return typeof o === 'object' && !!o && Object.hasOwn(o, SCHEMA_PROPERTY);
  }

  /**
   * Creates a new `Database` instance and initializes a connection pool.
   *
   * @param config - PostgreSQL connection string (e.g. `'postgresql://user:pass@host/db'`)
   *   or a `pg.ClientConfig` object
   * @param poolConfig - optional pool configuration. Use the `types` key to override
   *   per-pool type parsers without affecting other pools
   *
   * @example
   * ```ts
   * import { Database } from 'oopg';
   *
   * // Basic connection string
   * const db = new Database('postgresql://localhost/mydb');
   *
   * // Override type parsers — return BigInt for INT8 columns
   * const db2 = new Database(process.env.DATABASE_URL!, {
   *   types: { INT8: (val) => BigInt(val) },
   * });
   * ```
   */
  constructor(
    config: string | ClientConfig,
    poolConfig?: Omit<PoolConfig & ClientConfig, 'types'> & {
      debug?: boolean;
      types?: Partial<Record<BuiltinsTypes, (val: string) => unknown>>;
    },
  ) {
    const { types: typeOverrides, ...restPoolConfig } = poolConfig ?? {};
    this.#typeOverrides = typeOverrides;
    // this.config = typeof config === 'string' ? parseConnectionString(config) : config;
    this.#config = Object.freeze({
      ...restPoolConfig,
      ...(typeof config === 'string' ? parseConnectionString(config) : config),
      // idleTimeoutMillis: 0,
    });
    this.pool = new Pool({
      ...this.#config,
      types: buildTypeParser(this.#typeOverrides),
    });
    this.pool.on('acquire', (client) => {
      const clientId = ++ClientID;
      this.#acquired.set(client, clientId);
      if (poolConfig?.debug) {
        LL.wth('Client acquired', clientId, '=>', this.#acquired.size);
      }
    });
    this.pool.on('release', (err, client) => {
      const clientId = this.#acquired.get(client);
      if (clientId) this.#acquired.delete(client);
      if (poolConfig?.debug) {
        LL.wth(
          'Client released',
          clientId,
          '=>',
          this.#acquired.size,
          this.status,
        );
      }
    });
    this.pool.on('error', (e) => L.warn('Idle(?) client error', e.message));

    this.eventEmitter.on('newListener', async (eventName) => {
      if (eventName === 'removeListener' || eventName === 'newListener') return;
      if (!this.listenerClient) {
        this.listenerClient = this.pool.connect().then((client) => {
          client.on('notification', ({ channel, payload }) => {
            this.eventEmitter.emit(channel, payload);
          });
          return client;
        });
      }
      if (!this.eventEmitter.listenerCount(eventName)) {
        this.listenerClient.then((client) =>
          clientQuery(client, `LISTEN ${eventName}`, { debug: true }),
        );
      }
    });

    this.eventEmitter.on('removeListener', async (eventName) => {
      if (this.listenerClient) {
        const oldListener = this.listenerClient;
        if (
          !this.eventEmitter
            .eventNames()
            .filter((e) => e !== 'newListener' && e !== 'removeListener').length
        )
          this.listenerClient = undefined;
        if (!this.eventEmitter.listenerCount(eventName)) {
          await oldListener.then((client) =>
            clientQuery(client, `UNLISTEN ${eventName}`, { debug: true }),
          );
          if (!this.eventEmitter.eventNames().length) {
            await oldListener.then((client) => {
              LL.debug('Release and destroy listener client');
              client.release(true);
            });
          }
        }
      }
    });
  }
  /** Emits a named event through the internal EventEmitter. */
  emit(...params: Parameters<EventEmitter['emit']>) {
    return this.eventEmitter.emit(...params);
  }

  /**
   * Subscribes to a PostgreSQL LISTEN/NOTIFY channel. The database automatically
   * issues `LISTEN <channel>` on a dedicated connection the first time a listener
   * is registered.
   *
   * @param params - event name (channel) and listener function
   * @returns `this` for chaining
   *
   * @example
   * ```ts
   * import { Database } from 'oopg';
   *
   * const db = new Database(process.env.DATABASE_URL!);
   *
   * db.on('user_created', (payload) => {
   *   console.log('new user payload:', payload);
   * });
   * ```
   */
  on(...params: Parameters<EventEmitter['on']>) {
    this.eventEmitter.on(...params);
    return this;
  }

  /** Adds a listener via `addListener` — alias for `on`. */
  addListener(...params: Parameters<EventEmitter['addListener']>) {
    this.eventEmitter.addListener(...params);
    return this;
  }

  /** Subscribes a one-time listener for a LISTEN/NOTIFY channel. Unsubscribes after first invocation. */
  once(...params: Parameters<EventEmitter['once']>) {
    this.eventEmitter.once(...params);
    return this;
  }

  /** Removes a previously registered listener from a channel. Issues `UNLISTEN` when no listeners remain. */
  removeListener(...params: Parameters<EventEmitter['removeListener']>) {
    this.eventEmitter.removeListener(...params);
    return this;
  }

  /** Removes a previously registered listener from a channel — alias for `removeListener`. */
  off(...params: Parameters<EventEmitter['off']>) {
    this.eventEmitter.off(...params);
    return this;
  }

  /** Returns the list of currently registered event names. */
  eventNames() {
    return this.eventEmitter.eventNames();
  }

  /** Returns all listeners registered for the given event name. */
  listeners(...params: Parameters<EventEmitter['listeners']>) {
    return this.eventEmitter.listeners(...params);
  }

  /** Returns the number of listeners registered for the given event name. */
  listenerCount(...params: Parameters<EventEmitter['listenerCount']>) {
    return this.eventEmitter.listenerCount(...params);
  }

  /** Removes all listeners for a given event, or all events if no event is specified. */
  removeAllListeners(
    ...params: Parameters<EventEmitter['removeAllListeners']>
  ) {
    this.eventEmitter.removeAllListeners(...params);
    return this;
  }

  get config() {
    return structuredClone(this.#config);
  }

  get _typeOverrides():
    | Partial<Record<BuiltinsTypes, (val: string) => unknown>>
    | undefined {
    return this.#typeOverrides;
  }

  protected get _defaultSchema(): string {
    return (
      (this.constructor as typeof Database).DEFAULT_SCHEMA ??
      DEFAULT_POSTGRES_SCHEMA
    );
  }

  get status() {
    return {
      unreleased: this.#acquired.size,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      total: this.pool.totalCount,
    };
  }

  /**
   * Executes the callback inside a `BEGIN`/`COMMIT` transaction block.
   * The callback receives a transaction-scoped client and explicit `commit`/`rollback`
   * functions. If the callback returns without calling either, the transaction is
   * rolled back automatically (unless `autoCommit: true` is passed).
   *
   * @param callback - async function that performs queries and must call `commit()` or `rollback()`
   * @param options - optional `autoCommit` flag and debug options
   * @returns the value returned by the callback
   *
   * @example
   * ```ts
   * import { Database } from 'oopg';
   *
   * const db = new Database(process.env.DATABASE_URL!);
   *
   * const userId = await db.transaction(async (tx, { commit, rollback }) => {
   *   const [user] = await tx.select<{ id: string }>(
   *     'INSERT INTO users (name) VALUES ($1) RETURNING id', ['Alice'],
   *   );
   *   if (!user) { await rollback(); return null; }
   *   await commit();
   *   return user.id;
   * });
   * ```
   */
  async transaction<T>(
    callback: (
      transaction: this,
      functions: { commit: () => Promise<void>; rollback: () => Promise<void> },
    ) => Promise<T> | T,
    options?: TransactionOptions,
  ) {
    const { autoCommit, ...opOptions } = options ?? {};
    const client = await this.pool.connect();

    // Suppress release() during the transaction — actual release happens in finally
    const originalRelease = client.release.bind(client);
    client.release = () => {};

    const txClient = new TransactionClient(client, this);

    const commit = async () => {
      if (txClient.isDone) return; // idempotent per BUG-03
      await execute(client, 'COMMIT', opOptions);
      txClient.markDone();
    };
    const rollback = async () => {
      if (txClient.isDone) return; // idempotent per BUG-03
      await execute(client, 'ROLLBACK', opOptions);
      txClient.markDone();
    };

    try {
      await execute(client, 'BEGIN', opOptions);
      const returned = await callback(txClient as unknown as this, {
        commit,
        rollback,
      });
      if (!txClient.isDone) {
        if (autoCommit) {
          await commit();
        } else {
          await rollback();
        }
      }
      return returned;
    } catch (e) {
      if (!txClient.isDone) await rollback();
      throw e;
    } finally {
      client.release = originalRelease;
      client.release();
    }
  }

  private _sqlContext?: ReturnType<typeof createSQLContext<this, false>>;

  getSQLValuesOptions<V, O>(
    query: SQLQuery<this> | string,
    valuesOrOptions?: V[] | O,
    optionsWhenValues?: O,
  ) {
    let sql: string;
    let values: V[];
    let options: O | undefined;
    if (typeof query === 'string') {
      sql = query;
      values = Array.isArray(valuesOrOptions) ? valuesOrOptions : [];
      options = Array.isArray(valuesOrOptions)
        ? optionsWhenValues
        : valuesOrOptions;
    } else {
      const context = this._sqlContext ?? createSQLContext(this);
      const generated = query(context.sql, context.tables, context.utils);
      sql = generated.sql;
      values = generated.values;
      options = Array.isArray(valuesOrOptions)
        ? optionsWhenValues
        : valuesOrOptions;
    }

    return { sql, values, options };
  }

  /**
   * Executes a SELECT query and returns all matching rows.
   * When `options.stream` is `true`, returns a readable stream instead.
   *
   * @param sql - SQL string or query template function
   * @param values - optional positional parameter values
   * @param options - optional query options including `stream` flag
   * @returns array of typed row objects, or a `Readable` stream when streaming
   *
   * @example
   * ```ts
   * const users = await db.select<{ id: string; name: string }>(
   *   'SELECT id, name FROM users WHERE active = $1',
   *   [true],
   * );
   * ```
   */
  select<R extends Row = Row>(
    queryTemplate: SQLQuery<this>,
    options: Omit<DatabaseSelectOptions, 'stream'> & { stream: true },
  ): Promise<Readable>;
  select<R extends Row = Row>(
    queryTemplate: SQLQuery<this>,
    options?: DatabaseSelectOptions,
  ): Promise<R[]>;
  select<R extends Row = Row>(
    sql: string,
    options: Omit<DatabaseSelectOptions, 'stream'> & { stream: true },
  ): Promise<Readable>;
  select<R extends Row = Row>(
    sql: string,
    options?: DatabaseSelectOptions,
  ): Promise<R[]>;
  select<R extends Row = Row>(
    sql: string,
    values: unknown[],
    options: Omit<DatabaseSelectOptions, 'stream'> & { stream: true },
  ): Promise<Readable>;
  select<R extends Row = Row>(
    sql: string,
    values: unknown[],
    options?: DatabaseSelectOptions,
  ): Promise<R[]>;
  async select(
    query: SQLQuery<this> | string,
    valuesOrOptions?: unknown[] | DatabaseSelectOptions,
    optionsWhenValues?: DatabaseSelectOptions,
  ) {
    const client = await this.pool.connect();
    const { sql, values, options } = this.getSQLValuesOptions(
      query,
      valuesOrOptions,
      optionsWhenValues,
    );
    if (options?.stream) {
      const str = stream(client, sql, values, options);
      str.on('error', (e) => {
        LL.error(e);
      });
      str.on('close', () => client.release());
      return str as Readable;
    }
    const result = await select(client, sql, values, options);
    client.release();
    return result;
  }

  /**
   * Executes a non-SELECT SQL statement (INSERT, UPDATE, DELETE, DDL).
   *
   * @param sql - SQL string or query template function
   * @param values - optional positional parameter values
   * @param options - optional debug options
   * @returns execution result including `command`, `count`, `rows`, and `fields`
   *
   * @example
   * ```ts
   * const result = await db.execute(
   *   'UPDATE users SET active = $1 WHERE last_login < $2',
   *   [false, cutoffDate],
   * );
   * console.log(`deactivated ${result.count} users`);
   * ```
   */
  execute<R extends Row = Row>(
    queryTemplate: SQLQuery<this>,
    options?: OperationOptions,
  ): Promise<ExecuteResult<R>>;
  execute<R extends Row = Row>(
    sql: string,
    options?: OperationOptions,
  ): Promise<ExecuteResult<R>>;
  execute<R extends Row = Row>(
    sql: string,
    values: unknown[],
    options?: OperationOptions,
  ): Promise<ExecuteResult<R>>;
  async execute<R extends Row = Row>(
    query: SQLQuery<this> | string,
    valuesOrOptions?: unknown[] | OperationOptions | undefined,
    optionsWhenValues?: OperationOptions | undefined,
  ) {
    const client = await this.pool.connect();
    const { sql, values, options } = this.getSQLValuesOptions(
      query,
      valuesOrOptions,
      optionsWhenValues,
    );
    const result: ExecuteResult<R> = await execute<R>(
      client,
      sql,
      values,
      options,
    );
    client.release();
    return result;
  }

  /**
   * Opens a server-side cursor for the query and returns a `pg-cursor` instance.
   * The caller is responsible for reading rows and closing the cursor.
   *
   * @param sql - SQL string or query template function
   * @param values - optional positional parameter values
   * @param options - optional cursor options
   * @returns a `pg-cursor` instance
   *
   * @example
   * ```ts
   * const curs = await db.cursor('SELECT id FROM large_table');
   * let batch: { id: string }[];
   * while ((batch = await curs.read(100)).length) {
   *   for (const row of batch) process(row);
   * }
   * await curs.close();
   * ```
   */
  cursor<R extends Row = Row>(
    queryTemplate: SQLQuery<this>,
    options?: CursorOptions,
  ): Promise<Cursor<R>>;
  cursor<R extends Row = Row>(
    sql: string,
    options?: CursorOptions,
  ): Promise<Cursor<R>>;
  cursor<R extends Row = Row>(
    sql: string,
    values: unknown[],
    options?: CursorOptions,
  ): Promise<Cursor<R>>;
  async cursor<R extends Row = Row>(
    query: SQLQuery<this> | string,
    valuesOrOptions?: unknown[] | CursorOptions | undefined,
    optionsWhenValues?: CursorOptions | undefined,
  ) {
    const client = await this.pool.connect();
    const { sql, values, options } = this.getSQLValuesOptions(
      query,
      valuesOrOptions,
      optionsWhenValues,
    );
    const curs = cursor<R>(client, sql, values, options);
    curs.once('end', () => {
      LL.debug('Cursor end');
      client.release();
    });
    curs.once('close', () => {
      LL.debug('Cursor close');
      client.release();
    });
    return curs;
  }

  /**
   * Processes query results in fixed-size batches using a server-side cursor.
   * The callback is called for each batch until all rows are consumed.
   *
   * @param sql - SQL string or query template function
   * @param callback - async function called with each batch of rows
   * @param options - optional chunk size and debug options (default chunk size: 1000)
   * @returns promise that resolves when all batches have been processed
   *
   * @example
   * ```ts
   * await db.chunks<{ id: string; email: string }>(
   *   'SELECT id, email FROM users',
   *   async (rows) => {
   *     await sendEmails(rows);
   *   },
   *   { size: 500 },
   * );
   * ```
   */
  chunks<R extends Row = Row>(
    queryTemplate: SQLQuery<this>,
    callback: ChunkCallback<R>,
    options?: ChunksOptions,
  ): Promise<void>;
  chunks<R extends Row = Row>(
    sql: string,
    values: unknown[],
    callback: ChunkCallback<R>,
    options?: ChunksOptions,
  ): Promise<void>;
  chunks<R extends Row = Row>(
    sql: string,
    callback: ChunkCallback<R>,
    options?: ChunksOptions,
  ): Promise<void>;
  async chunks<R extends Row>(
    query: SQLQuery<this> | string,
    valuesOrCallback: unknown[] | ChunkCallback<R>,
    callbackWhenValuesOrOptionsWhenNoValues?:
      | ChunkCallback<R>
      | ChunksOptions
      | undefined,
    optionsWhenValues?: ChunksOptions | undefined,
  ) {
    const client = await this.pool.connect();
    const callback =
      typeof valuesOrCallback === 'function'
        ? valuesOrCallback
        : typeof callbackWhenValuesOrOptionsWhenNoValues === 'function'
          ? callbackWhenValuesOrOptionsWhenNoValues
          : undefined;
    const { sql, values, options } = this.getSQLValuesOptions(
      query,
      Array.isArray(valuesOrCallback) ? valuesOrCallback : [],
      typeof callbackWhenValuesOrOptionsWhenNoValues === 'function'
        ? optionsWhenValues
        : callbackWhenValuesOrOptionsWhenNoValues,
    );
    if (!callback) throw new Error('No callback');
    await chunk(client, sql, values, callback, options);
    client.release();
  }

  /**
   * Processes query results one row at a time using a server-side cursor.
   *
   * @param sql - SQL string or query template function
   * @param callback - async function called with each individual row
   * @param options - optional cursor and debug options
   * @returns promise that resolves when all rows have been processed
   *
   * @example
   * ```ts
   * await db.step<{ id: string; name: string }>(
   *   'SELECT id, name FROM users',
   *   async (row) => {
   *     await processUser(row);
   *   },
   * );
   * ```
   */
  step<R extends Row = Row>(
    queryTemplate: SQLQuery<this>,
    callback: StepCallback<R>,
    options?: StepOptions,
  ): Promise<void>;
  step<R extends Row = Row>(
    sql: SQLQuery<this>,
    values: unknown[],
    callback: StepCallback<R>,
    options?: StepOptions,
  ): Promise<void>;
  step<R extends Row = Row>(
    sql: string,
    callback: StepCallback<R>,
    options?: StepOptions,
  ): Promise<void>;
  async step<R extends Row>(
    query: SQLQuery<this> | string,
    valuesOrCallback: unknown[] | StepCallback<R>,
    callbackOrOptions?: StepCallback<R> | StepOptions | undefined,
    optionsWhenValues?: StepOptions | undefined,
  ) {
    const client = await this.pool.connect();
    const callback =
      typeof valuesOrCallback === 'function'
        ? valuesOrCallback
        : typeof callbackOrOptions === 'function'
          ? callbackOrOptions
          : () => {};
    const { sql, values, options } = this.getSQLValuesOptions(
      query,
      Array.isArray(valuesOrCallback) ? valuesOrCallback : [],
      typeof callbackOrOptions === 'function'
        ? optionsWhenValues
        : callbackOrOptions,
    );
    await step<R>(client, sql, values, callback, options);
    client.release();
  }

  /**
   * Executes a SELECT query and returns the first matching row, or `undefined` if none.
   *
   * @param sql - SQL string or query template function
   * @param values - optional positional parameter values
   * @param options - optional cursor and debug options
   * @returns the first row, or `undefined`
   *
   * @example
   * ```ts
   * const user = await db.first<{ id: string; name: string }>(
   *   'SELECT id, name FROM users WHERE email = $1',
   *   ['alice@example.com'],
   * );
   * if (user) console.log('found:', user.name);
   * ```
   */
  first<R extends Row = Row>(
    queryTemplate: SQLQuery<this>,
    options?: CursorOptions,
  ): Promise<R | undefined>;
  first<R extends Row = Row>(
    sql: string,
    options?: CursorOptions,
  ): Promise<R | undefined>;
  first<R extends Row = Row>(
    sql: string,
    values: unknown[],
    options?: CursorOptions,
  ): Promise<R | undefined>;
  async first<R extends Row = Row>(
    query: SQLQuery<this> | string,
    valuesOrOptions?: unknown[] | CursorOptions,
    optionsWhenValues?: CursorOptions | undefined,
  ): Promise<R | undefined> {
    const client = await this.pool.connect();
    const { sql, values, options } = this.getSQLValuesOptions(
      query,
      valuesOrOptions,
      optionsWhenValues,
    );
    const found = await first<R>(client, sql, values, options);
    client.release();
    return found;
  }

  async tableExists(table: EntityDescription) {
    const client = await this.pool.connect();
    const exists = await tableExists(client, table);
    client.release();
    return exists;
  }

  async viewExists(table: EntityDescription) {
    const client = await this.pool.connect();
    const exists = await viewExists(client, table);
    client.release();
    return exists;
  }

  async createTable<COLS extends CreateTableColumns<Record<string, unknown>>>(
    table: EntityDescription,
    columns: COLS,
    options?: CreateTableOptions,
  ) {
    const client = await this.pool.connect();
    await createTable(client, table, columns, options);
    client.release();

    return this.table<
      OutputType<COLS>,
      AutoColumns<COLS> extends keyof OutputType<COLS>
        ? AutoColumns<COLS>
        : keyof OutputType<COLS>
    >(table);
  }

  // async outputToTable(name: string, options?: TableOutputOptions) {
  // 	const client = await this.pool.connect();
  // 	const { enqueue, close } = tableOutput(client, name, options);
  // 	return { enqueue, close: () => close().then(() => client.release()) };
  // }

  /**
   * Acquires a client from the pool, passes it to the callback, and releases it when done.
   *
   * @param callback - function that receives the raw `pg.ClientBase` and an explicit `release()` function
   * @param autoRelease - when `true` (default), the client is released automatically after the callback resolves
   * @returns the value returned by the callback
   *
   * @example
   * ```ts
   * const result = await db.connect(async (client) => {
   *   return client.query('SELECT pg_backend_pid()');
   * });
   * ```
   */
  async connect<T>(
    callback: (client: ClientBase, release: () => void) => T,
    autoRelease = true,
  ) {
    const client = await this.pool.connect();
    // Suppress release() so the callback cannot release the client accidentally
    const originalRelease = client.release.bind(client);
    client.release = () => {};

    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        client.release = originalRelease;
        client.release();
      }
    };
    try {
      const result = await callback(client as ClientBase, release);
      if (autoRelease && !released) {
        release();
      }
      return result;
    } catch (e) {
      if (!released) release();
      throw e;
    }
  }

  /**
   * Builds a typed schema by defining tables, views, and functions scoped to a
   * PostgreSQL schema name.
   *
   * @param schemaName - the PostgreSQL schema name (e.g. `'app'`, `'public'`)
   * @param sch - builder callback that receives `{ table, view, func }` utilities
   * @returns the schema definition object with typed entity references
   *
   * @example
   * ```ts
   * const schema = db.schema('app', ({ table }) => ({
   *   users: table<{ name: string }>('users'),
   * }));
   * const rows = await schema.users.find({});
   * ```
   */
  schema<B extends SchemaBuilder<this, Schema>>(schemaName: string, sch: B) {
    const builtSchema = sch({
      table: (tableDesc: EntityDescription) => {
        return this.table(
          typeof tableDesc === 'string'
            ? { schema: schemaName, name: tableDesc }
            : { ...tableDesc, schema: schemaName },
        );
      },
      view: ((viewDesc: EntityDescription, materialized?: boolean) => {
        const desc =
          typeof viewDesc === 'string'
            ? { schema: schemaName, name: viewDesc }
            : { ...viewDesc, schema: schemaName };
        return materialized ? this.view(desc, true) : this.view(desc);
      }) as unknown as this['view'],
      func: (...args: Parameters<Database['func']>) => {
        let [funcDesc, params] = args;
        if (typeof funcDesc === 'string') {
          funcDesc = { schema: schemaName, name: funcDesc };
        } else {
          funcDesc = { ...funcDesc, schema: schemaName };
        }
        return this.func(funcDesc, params);
      },
    });
    Object.defineProperty(builtSchema, SCHEMA_PROPERTY, {
      value: true,
      writable: false,
      enumerable: false,
    });
    return builtSchema as ReturnType<B>;
  }

  /**
   * Defines a typed table entity in the database schema.
   *
   * @param name - table name or `{ name, schema }` descriptor
   * @returns a `Table` entity with typed `find`, `insert`, `update`, `delete`, and `create` methods
   *
   * @example
   * ```ts
   * const users = db.table<{ name: string; email: string }>('users');
   * const all = await users.find({});
   * ```
   */
  table<R extends Row = Row, AUTO extends keyof R = never>(
    name: EntityDescription,
  ) {
    const desc =
      typeof name === 'string'
        ? {
            schema: this._defaultSchema,
            name,
          }
        : name;
    return new TableImpl(this, desc) as Table<EntityRow<R, AUTO>>;
  }

  /**
   * Defines a typed view entity. Pass `materialized: true` for materialized views.
   *
   * @param name - view name or `{ name, schema }` descriptor
   * @param materialized - when `true`, returns a `MaterializedView` that supports `refresh()`
   * @returns a `View` or `MaterializedView` entity
   *
   * @example
   * ```ts
   * const activeUsers = db.view<{ id: string; name: string }>('active_users');
   * const rows = await activeUsers.find({});
   * ```
   */
  view<R extends Row = Row, AUTO extends keyof R = never>(
    name: EntityDescription,
    materialized: true,
  ): MaterializedView<this, EntityRow<R, AUTO>>;
  view<R extends Row = Row, AUTO extends keyof R = never>(
    name: EntityDescription,
    materialized?: false,
  ): View<this, EntityRow<R, AUTO>>;
  view<R extends Row = Row, AUTO extends keyof R = never>(
    name: EntityDescription,
    materialized?: boolean,
  ) {
    const desc =
      typeof name === 'string'
        ? {
            schema: this._defaultSchema,
            name,
          }
        : name;
    return materialized
      ? (new MaterializedViewImpl(this, desc) as MaterializedView<
          this,
          EntityRow<R, AUTO>
        >)
      : (new ViewImpl(this, desc) as View<this, EntityRow<R, AUTO>>);
  }

  /**
   * Defines a typed function entity for a PostgreSQL function.
   *
   * @param name - function name or `{ name, schema }` descriptor
   * @param args - tuple of `PGType` values describing the function's parameter types
   * @returns a `Func` entity with a `create()` method for DDL management
   *
   * @example
   * ```ts
   * const myFunc = db.func('compute_score', ['int', 'int']);
   * await myFunc.create(['a', 'b'], 'SELECT $1 + $2');
   * ```
   */
  // 1 argument
  func<ARGS extends [PGType | [PGType]]>(
    name: EntityDescription,
    args: ARGS,
  ): Func<this, ARGS>;
  // 2 arguments
  func<ARGS extends [PGType | [PGType], PGType | [PGType]]>(
    name: EntityDescription,
    args: ARGS,
  ): Func<this, ARGS>;
  // 3 arguments
  func<ARGS extends [PGType | [PGType], PGType | [PGType], PGType | [PGType]]>(
    name: EntityDescription,
    args: ARGS,
  ): Func<this, ARGS>;
  // 4 arguments
  func<
    ARGS extends [
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
    ],
  >(name: EntityDescription, args: ARGS): Func<this, ARGS>;
  // 5 arguments
  func<
    ARGS extends [
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
    ],
  >(name: EntityDescription, args: ARGS): Func<this, ARGS>;
  // 6 arguments
  func<
    ARGS extends [
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
    ],
  >(name: EntityDescription, args: ARGS): Func<this, ARGS>;
  // 7 arguments
  func<
    ARGS extends [
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
    ],
  >(name: EntityDescription, args: ARGS): Func<this, ARGS>;
  // 8 arguments
  func<
    ARGS extends [
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
    ],
  >(name: EntityDescription, args: ARGS): Func<this, ARGS>;
  // 9 arguments
  func<
    ARGS extends [
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
    ],
  >(name: EntityDescription, args: ARGS): Func<this, ARGS>;
  // 10 arguments
  func<
    ARGS extends [
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
      PGType | [PGType],
    ],
  >(name: EntityDescription, args: ARGS): Func<this, ARGS>;
  func<ARGS extends (PGType | [PGType])[]>(
    name: EntityDescription,
    args: ARGS,
  ) {
    const desc =
      typeof name === 'string'
        ? {
            schema: this._defaultSchema,
            name,
          }
        : name;
    return new FuncImpl(this, desc, args);
  }

  async tables() {
    return (await this.connect((client) => getAllTables(client))).map((t) =>
      this.table(t),
    );
  }

  async views() {
    return (await this.connect((client) => getAllViews(client))).map((t) =>
      this.view(t),
    );
  }
}

/**
 * Transaction-scoped database client. Extends `Database` to execute all queries
 * against a single connection within a transaction block.
 *
 * Users receive a `TransactionClient` as the first argument of the `transaction()`
 * callback — it should not be constructed directly.
 *
 * @example
 * ```ts
 * import { Database } from 'oopg';
 *
 * // The tx argument inside transaction() is a TransactionClient
 * await db.transaction(async (tx, { commit }) => {
 *   await tx.execute('INSERT INTO events (name) VALUES ($1)', ['signup']);
 *   await commit();
 * });
 * ```
 */
// TransactionClient wraps an already-acquired PoolClient and routes all query
// operations through that client instead of the parent pool. It is intentionally
// NOT exported from index.ts (internal implementation detail per D-04).
// Export is needed only so tests can assert `instanceof TransactionClient`.
export class TransactionClient extends Database {
  #txDone = false;
  #client: PoolClient;
  #parentPool: Pool;

  constructor(client: PoolClient, parentDb: Database) {
    // super() creates a Pool that will never connect (pg.Pool is lazy).
    // We end it immediately to avoid any resource leak.
    super(parentDb.config, { types: parentDb._typeOverrides });
    this.#client = client;
    this.#parentPool = parentDb.pool;
    // End the unused pool created by super() — it is immediately replaced below.
    // pg.Pool.end() is safe to call on a pool with zero connections.
    this.pool.end().catch(() => {}); // ignore errors on empty pool end
    // Replace the unused pool with a minimal pool-shaped object whose connect()
    // returns the already-acquired client (with release() already no-op'd by
    // the caller in Database.transaction()).
    this.pool = this.#makeTransactionPool();
  }

  #makeTransactionPool(): Pool {
    const client = this.#client;
    const parentPool = this.#parentPool;
    return {
      connect: () =>
        this.#txDone ? parentPool.connect() : Promise.resolve(client),
      // Delegate status properties to the parent pool (Pitfall 3)
      get idleCount() {
        return parentPool.idleCount;
      },
      get waitingCount() {
        return parentPool.waitingCount;
      },
      get totalCount() {
        return parentPool.totalCount;
      },
      end: () => Promise.resolve(),
      on: parentPool.on.bind(parentPool),
    } as unknown as Pool;
  }

  // Override transaction() to prevent nested transactions (D-06)
  override async transaction(): Promise<never> {
    throw new Error('Cannot initiate nested transaction');
  }

  // Called by commit()/rollback() in Database.transaction() to mark the
  // transaction as complete — after this, pool.connect() falls back to the
  // parent pool so any post-transaction operations work correctly.
  markDone(): void {
    this.#txDone = true;
  }

  get isDone(): boolean {
    return this.#txDone;
  }
}

/**
 * Maps row types for a database entity, separating the output shape (SELECT)
 * from the input shape (INSERT), where auto-generated columns are optional on insert.
 */
export type EntityRow<ROW extends Row, AUTO extends keyof ROW = never> = {
  output: RowWithId<ROW>;
  input: { id?: RowWithId['id'] } & {
    [K in Exclude<keyof ROW, 'id'> as K extends AUTO
      ? K
      : never]?: ROW[K] extends undefined ? ROW[K] | null : ROW[K];
  } & Omit<ROW, AUTO>;
};

type FindOptions<T> = {} & OperationOptions;
type FindOneOptions<T> = FindOptions<T>;

/** Base interface for all schema elements (tables, views, functions). */
export interface DatabaseElement {
  readonly database: Database;
  readonly schema: string;
  readonly name: string;
}

/**
 * Type guard that returns `true` when `element` is a `Table` entity.
 *
 * @param element - any value to test
 * @returns `true` if element is a `Table`
 */
export const isTable = (element: unknown): element is Table<EntityRow<Row>> => {
  return element instanceof TableImpl;
};

/**
 * Type guard that returns `true` when `element` is a `View` entity.
 *
 * @param element - any value to test
 * @returns `true` if element is a `View`
 */
export const isView = (
  element: unknown,
): element is View<Database, EntityRow<Row>> => {
  return element instanceof ViewImpl;
};

/**
 * Type guard that returns `true` when `element` is a `Func` entity.
 *
 * @param element - any value to test
 * @returns `true` if element is a `Func`
 */
export const isFunc = (
  element: unknown,
): element is Func<Database, (PGType | [PGType])[]> => {
  return element instanceof FuncImpl;
};

/** Interface for schema elements with typed row definitions, providing `find` and `one` query methods. */
export interface DatabaseEntity<EROW extends EntityRow<Row>>
  extends DatabaseElement {
  find(
    id: EROW['output']['id'],
    options?: FindOptions<EROW['output']>,
  ): Promise<EROW['output'] | undefined>;
  find(
    filter: Partial<EROW['output']>,
    options?: FindOptions<EROW['output']>,
  ): Promise<EROW['output'][]>;

  one(
    id: EROW['output']['id'],
    options?: FindOneOptions<EROW['output']>,
  ): Promise<EROW['output'] | undefined>;
  one(
    filter: Partial<EROW['output']>,
    options?: FindOneOptions<EROW['output']>,
  ): Promise<EROW['output'] | undefined>;

  exists(): Promise<boolean>;
}

abstract class DatabaseElementHelper {
  database: Database;
  schema: string;
  name: string;

  constructor(db: Database, table: EntityDescription) {
    this.database = db;
    const { name, schema } = descriptionToEntity(table);
    this.name = name;
    this.schema = schema ?? DEFAULT_POSTGRES_SCHEMA;
  }
}

abstract class DatabaseEntityHelper<
  EROW extends EntityRow<Row>,
> extends DatabaseElementHelper {
  protected filterToWhere(filter: Record<string, unknown>, offset = 0) {
    let off = offset;
    let sql = '';
    const values: unknown[] = [];
    for (const [column, value] of Object.entries(filter)) {
      sql += values.length ? ' AND ' : '';
      sql += `"${this.schema}"."${this.name}"."${column}" = $${++off}`;
      values.push(value);
    }
    return { sql, values };
  }

  protected dataToAssign(filter: Record<string, unknown>, offset = 0) {
    let off = offset;
    let sql = '';
    const values: unknown[] = [];
    for (const [column, value] of Object.entries(filter)) {
      sql += !off++ ? '' : ', ';
      sql += `"${column}" = $${off}`;
      values.push(value);
    }
    return { sql, values };
  }

  find(
    id: EROW['output']['id'],
    options?: FindOptions<EROW['output']>,
  ): Promise<EROW['output'] | undefined>;
  find(
    filter: Partial<EROW['output']>,
    options?: FindOptions<EROW['output']>,
  ): Promise<EROW['output'][]>;
  find(
    idOrFilter?: EROW['output']['id'] | Partial<EROW['output']>,
    options?: FindOptions<EROW['output']>,
  ) {
    if (typeof idOrFilter === 'string') {
      return this.database.first<EROW['output']>(
        `SELECT * FROM "${this.schema}"."${this.name}" WHERE id = $1`,
        [idOrFilter],
      );
    }
    const { sql: where, values } = this.filterToWhere(idOrFilter ?? {});
    return this.database.select<EROW['output']>(
      `SELECT * FROM "${this.schema}"."${this.name}" ${where ? `WHERE ${where}` : ''}`,
      values,
    );
  }

  one(
    idOrFilter: EROW['output']['id'] | Partial<EROW['output']>,
    options?: Omit<FindOptions<EROW['output']>, 'max'>,
  ) {
    if (typeof idOrFilter === 'string') {
      return this.database.first<EROW['output']>(
        `SELECT * FROM "${this.schema}"."${this.name}" WHERE id = $1`,
        [idOrFilter],
        options,
      );
    }
    const { sql: where, values } = this.filterToWhere(idOrFilter ?? {});
    return this.database.first<EROW['output']>(
      `SELECT * FROM "${this.schema}"."${this.name}" ${where ? `WHERE ${where}` : ''}`,
      values,
      options,
    );
  }

  alter() {
    return {
      createIndexes: async (
        ...params: Parameters<typeof createIndexes<EROW['input']>> extends [
          ClientBase,
          EntityDescription,
          ...infer ARGS,
        ]
          ? ARGS
          : never
      ) => {
        await this.database.connect((client) =>
          createIndexes<EROW['input']>(client, this, ...params),
        );
      },
    };
  }

  // async createIndexes(
  // 	...params: Parameters<typeof createIndexes<EROW['input']>> extends [
  // 		ClientBase,
  // 		EntityDescription,
  // 		...infer ARGS
  // 	]
  // 		? ARGS
  // 		: never
  // ) {
  // 	await this.database.connect(client => createIndexes<EROW['input']>(client, this, ...params));
  // }
}

type AlterEntityMethods<EROW extends EntityRow<RowWithId>> = {
  createIndexes(
    ...params: Parameters<typeof createIndexes<EROW['output']>> extends [
      ClientBase,
      EntityDescription,
      ...infer ARGS,
    ]
      ? ARGS
      : never
  ): ReturnType<typeof createIndexes<EROW['output']>>;
};

type AlterTableMethods<EROW extends EntityRow<RowWithId>> =
  AlterEntityMethods<EROW> & {
    addForeignKeys: (
      column: keyof EROW['output'],
      references: string | { name: string; schema?: string },
      columns?: string | string[],
      options?: AddForeignKeyOptions,
    ) => Promise<void>;

    dropColumn: (column: keyof EROW['output']) => Promise<void>;

    alterColumn: (
      column: keyof EROW['output'],
      options: AlterColumnOptions,
    ) => Promise<void>;
  };

type AlterViewMethods<EROW extends EntityRow<RowWithId>> =
  AlterEntityMethods<EROW> & {
    // addForeignKeys: (column: keyof EROW['output'], references: { name: string; schema?: string }) => Promise<void>;
  };

/**
 * A typed table entity returned by `db.table()`. Provides CRUD methods (`find`, `insert`,
 * `update`, `delete`, `create`, `truncate`, `drop`) and bulk operation methods.
 *
 * @example
 * ```ts
 * const users = db.table<{ name: string; email: string }>('users');
 * const user = await users.insert({ name: 'Alice', email: 'alice@example.com' });
 * const found = await users.find({ email: 'alice@example.com' });
 * ```
 */
export interface Table<EROW extends EntityRow<RowWithId> = EntityRow<RowWithId>>
  extends DatabaseEntity<EROW> {
  create(
    columns: CreateTableColumns<EROW['output']>,
    options?: CreateTableOptions<EROW['output']>,
  ): Promise<void>;

  insert(
    data: EROW['input'] & { id?: never },
    options?: InsertOptions,
  ): Promise<EROW['output'] | undefined>;

  update(
    id: RowWithId['id'],
    data: Partial<EROW['output']> & { id?: never },
    options?: UpdateOptions,
  ): Promise<EROW['output'] | undefined>;
  update(
    filter: Partial<EROW['output']>,
    data: Partial<EROW['output']> & { id?: never },
    options?: UpdateOptions,
  ): Promise<EROW['output'][]>;

  delete(
    id: RowWithId['id'],
    options?: DeleteOptions,
  ): Promise<EROW['output'] | undefined>;
  delete(
    filter: Partial<EROW['output']>,
    options?: DeleteOptions,
  ): Promise<EROW['output'][]>;

  truncate(options?: TruncateOptions): Promise<void>;
  drop(options?: DropOptions): Promise<void>;

  createObjectStream<O extends CreateTableWriteStreamOptions<EROW['output']>>(
    options?: O,
  ): Promise<Writable>;
  bulkWrite(
    options?: BulkWriteOptions,
  ): Promise<ReturnType<typeof bulkWrite<EROW['input']>>>;
  output(
    options?: TableOutputOptions,
  ): Promise<ReturnType<typeof tableOutput<EROW['input']>>>;

  alter(): AlterTableMethods<EROW>;
}

/** A typed view entity returned by `db.view()`. Provides `find`, `one`, `create`, and `drop` methods. */
export interface View<DB extends Database, EROW extends EntityRow<Row>>
  extends DatabaseEntity<EROW> {
  readonly materialized: boolean;

  create(
    queryTemplate: SQLQuery<DB>,
    options?: OperationOptions,
  ): Promise<void>;
  create(sql: string, options?: OperationOptions): Promise<void>;
  create(
    sql: string,
    values: unknown[],
    options?: OperationOptions,
  ): Promise<void>;

  drop(options?: DropOptions): Promise<void>;

  alter(): AlterViewMethods<EROW>;
}

/** A typed materialized view entity returned by `db.view(name, true)`. Extends `View` with a `refresh()` method. */
export interface MaterializedView<
  DB extends Database,
  EROW extends EntityRow<Row>,
> extends View<DB, EROW> {
  refresh(options?: OperationOptions): Promise<void>;
}

/** A typed function entity returned by `db.func()`. Provides a `create()` method for DDL management. */
export interface Func<DB extends Database, ARGS extends (PGType | [PGType])[]>
  extends DatabaseElement {
  name: string;
  args: ARGS;

  create(
    params: { [K in keyof ARGS]: string },
    queryTemplate: SQLQuery<DB>,
    options?: OperationOptions,
  ): Promise<void>;
  create(
    params: { [K in keyof ARGS]: string },
    sql: string,
    options?: OperationOptions,
  ): Promise<void>;
  create(
    params: { [K in keyof ARGS]: string },
    sql: string,
    values: unknown[],
    options?: OperationOptions,
  ): Promise<void>;
}

class FuncImpl<DB extends Database, ARGS extends (PGType | [PGType])[]>
  extends DatabaseElementHelper
  implements Func<DB, ARGS>
{
  args: ARGS;
  returns?: PGType | [PGType];

  constructor(
    db: DB,
    name: EntityDescription,
    args: ARGS,
    returns?: PGType | [PGType],
  ) {
    super(db, name);
    this.args = structuredClone(args);
    this.returns = returns;
  }

  create(
    params: { [K in keyof ARGS]: string },
    queryTemplate: SQLQuery<DB>,
    options?: OperationOptions,
  ): Promise<void>;
  create(
    params: { [K in keyof ARGS]: string },
    sql: string,
    options?: OperationOptions,
  ): Promise<void>;
  create(
    params: { [K in keyof ARGS]: string },
    sql: string,
    values: unknown[],
    options?: OperationOptions,
  ): Promise<void>;
  async create(
    params: { [K in keyof ARGS]: string },
    query: SQLQuery<DB> | string,
    valuesOrOptions?: unknown[] | OperationOptions,
    optionsWhenValues?: OperationOptions | undefined,
  ) {
    const { sql, values, options } = this.database.getSQLValuesOptions(
      query as SQLQuery<Database> | string,
      valuesOrOptions,
      optionsWhenValues,
    );

    await this.database.execute(
      `
            CREATE OR REPLACE FUNCTION "${this.schema}"."${this.name}" (${this.args.map((t, i) => `${params[i]} ${columnTypeToSQL(t)}`).join(', ')})
            ${this.returns ? `RETURNS ${columnTypeToSQL(this.returns)}` : ''}
            AS $$
            ${sql}
            $$
            LANGUAGE SQL`,
      values,
      options,
    );
  }
}

type DataOperationOptions = OperationOptions & { returnType?: 'full' | 'id' };

type InsertOptions = DataOperationOptions;
type UpdateOptions = DataOperationOptions;
type DeleteOptions = DataOperationOptions;
type TruncateOptions = { cascade?: boolean } & OperationOptions;
type DropOptions = { cascade?: boolean; error?: boolean } & OperationOptions;

class TableImpl<EROW extends EntityRow<RowWithId>>
  extends DatabaseEntityHelper<EROW>
  implements Table<EROW>
{
  async create(
    columns: CreateTableColumns<EROW['output']>,
    options?: CreateTableOptions<EROW['output']>,
  ) {
    await this.database.createTable(
      this,
      columns,
      options as CreateTableOptions,
    );
  }

  insert(data: EROW['input'] & { id?: never }, options?: InsertOptions) {
    return this.database.first<EROW['output']>(
      `INSERT INTO "${this.schema}"."${this.name}" (${Object.keys(data)
        .map((col) => `"${col}"`)
        .join(', ')})
			VALUES (${Object.keys(data).map((_, i) => `$${i + 1}`)})
			RETURNING *`,
      Object.values(data),
      options,
    );
  }

  update(
    id: RowWithId['id'],
    data: Partial<EROW['output']> & { id?: never },
    options?: UpdateOptions,
  ): Promise<EROW['output'] | undefined>;
  update(
    id: RowWithId['id'],
    data: Partial<EROW['output']> & { id?: never },
    options?: UpdateOptions,
  ): Promise<EROW['output'] | undefined>;
  update(
    filter: Partial<EROW['output']>,
    data: Partial<EROW['output']> & { id?: never },
    options?: UpdateOptions,
  ): Promise<EROW['output'][]>;
  async update(
    idOrFilter: Partial<EROW['output']> | RowWithId['id'],
    data: Partial<EROW['output']>,
    options?: UpdateOptions,
  ) {
    // if (!Object.keys(data).length) return this.find(idOrFilter) as Promise<EROW['output'] | undefined>;
    const { sql: setSsql, values: setValues } = this.dataToAssign(data);
    const { returnType = 'full', ...opOptions } = options ?? {};
    if (typeof idOrFilter === 'string') {
      if (!setSsql.length) return undefined;
      return this.database.first<EROW['output']>(
        `UPDATE "${this.schema}"."${this.name}" SET ${setSsql} WHERE "id" = $${setValues.length + 1} RETURNING *`,
        [...setValues, idOrFilter],
        opOptions,
      );
    }
    if (!setSsql.length) return [];
    const { sql: whereSql, values: whereValues } = this.filterToWhere(
      idOrFilter ?? {},
      setValues.length,
    );
    return this.database.select<EROW['output']>(
      `UPDATE "${this.schema}"."${this.name}" SET ${setSsql} ${whereSql ? `WHERE ${whereSql}` : ''} RETURNING *`,
      [...setValues, ...whereValues],
      opOptions,
    );
  }

  delete(
    id: RowWithId['id'],
    options?: DeleteOptions,
  ): Promise<EROW['output'] | undefined>;
  delete(
    filter: Partial<EROW['output']>,
    options?: DeleteOptions,
  ): Promise<EROW['output'][]>;
  delete(
    idOrFilter: Partial<EROW['output']> | RowWithId['id'],
    options?: DeleteOptions,
  ) {
    const { ...opOptions } = options ?? {};
    if (typeof idOrFilter === 'string') {
      return this.database.first<EROW['output']>(
        `DELETE FROM "${this.schema}"."${this.name}" WHERE "id" = $${idOrFilter} RETURNING *`,
        opOptions,
      );
    }
    const { sql: whereSql, values: whereValues } = this.filterToWhere(
      idOrFilter ?? {},
    );
    return this.database.select<EROW['output']>(
      `DELETE FROM "${this.schema}"."${this.name}" ${whereSql ? `WHERE ${whereSql}` : ''} RETURNING *`,
      whereValues,
      opOptions,
    );
  }

  async createObjectStream(
    options?: CreateTableWriteStreamOptions<EROW['output']>,
  ) {
    return this.database.connect(async (client, release) => {
      const stream = await createTableObjectStream(client, this, options);
      stream.on('close', () => {
        if (options?.debug) {
          LL.debug('writeStream closed');
        }
        release();
      });
      return stream;
    }, false);
  }

  bulkWrite(options?: BulkWriteOptions) {
    return this.database.connect((client, release) => {
      const { enqueue, close } = bulkWrite(client, this, options);
      return {
        enqueue,
        close: () =>
          close().then((r) => {
            release();
            return r;
          }),
      };
    }, false);
  }

  output(options?: TableOutputOptions) {
    return this.database.connect((client, release) => {
      const { enqueue, close } = tableOutput(client, this, options);
      return {
        enqueue,
        close: () =>
          close().then((r) => {
            release();
            return r;
          }),
      };
    }, false);
  }

  async truncate(options?: TruncateOptions) {
    const { cascade, ...opOptions } = options ?? {};
    await this.database.execute(
      `TRUNCATE TABLE "${this.schema}"."${this.name}" ${cascade ? 'CASCADE' : ''}`,
      opOptions,
    );
  }

  async drop(options?: DropOptions) {
    const { cascade, ...opOptions } = options ?? {};
    await this.database.execute(
      `DROP TABLE "${this.schema}"."${this.name}" ${cascade ? 'CASCADE' : ''}`,
      opOptions,
    );
  }

  alter() {
    return {
      ...super.alter(),
      addForeignKeys: async (
        keys: keyof EROW['output'] | (keyof EROW['output'])[],
        references: string | { name: string; schema?: string },
        columns?: string | string[],
        options?: AddForeignKeyOptions,
      ) => {
        return this.database.connect((client) =>
          addForeignKey(
            client,
            this,
            keys as string | string[],
            references,
            columns ?? ['id'],
            options,
          ),
        );
      },
      dropColumn: async (column: keyof EROW['output']) => {
        throw new Error('dropColumn Not implemented');
      },
      alterColumn: async (
        column: keyof EROW['output'],
        options: AlterColumnOptions,
      ) => {
        return this.database.connect((client) =>
          alterColumn(client, this, column as string, options),
        );
      },
    };
  }

  exists() {
    return this.database.tableExists(this);
  }
}

class ViewImpl<DB extends Database, EROW extends EntityRow<RowWithId>>
  extends DatabaseEntityHelper<EROW>
  implements View<DB, EROW>
{
  protected _materialized: boolean;

  constructor(db: DB, entity: EntityDescription) {
    super(db, entity);
    this._materialized = false;
  }

  get materialized() {
    return this._materialized;
  }

  create(
    queryTemplate: SQLQuery<DB>,
    options?: OperationOptions,
  ): Promise<void>;
  create(sql: string, options?: OperationOptions): Promise<void>;
  create(
    sql: string,
    values: unknown[],
    options?: OperationOptions,
  ): Promise<void>;
  async create(
    query: SQLQuery<DB> | string,
    valuesOrOptions?: unknown[] | OperationOptions,
    optionsWhenValues?: OperationOptions | undefined,
  ) {
    const { sql, values, options } = this.database.getSQLValuesOptions(
      query as SQLQuery<Database> | string,
      valuesOrOptions,
      optionsWhenValues,
    );

    const { ...opOptions } = options ?? {};

    await this.database.connect(async (client) => {
      try {
        await clientQuery(
          client,
          `DROP MATERIALIZED VIEW IF EXISTS "${this.schema}"."${this.name}"`,
          opOptions,
        );
      } catch (e) {
        LL.warn(
          e instanceof Error ? e.message : JSON.stringify(e, undefined, 2),
        );
      }
      try {
        await clientQuery(
          client,
          `DROP VIEW IF EXISTS "${this.schema}"."${this.name}"`,
          opOptions,
        );
      } catch (e) {
        LL.warn(
          e instanceof Error ? e.message : JSON.stringify(e, undefined, 2),
        );
      }

      if (this._materialized) {
        await clientQuery(
          client,
          `CREATE MATERIALIZED VIEW IF NOT EXISTS "${this.schema}"."${this.name}" AS ${sql}`,
          values,
          opOptions,
        );
        // TOFIX
        // Some client GUI can't see materialized views
        await clientQuery(
          client,
          `CREATE VIEW "${this.schema}"."${this.name}Materialized" AS SELECT * FROM "${this.schema}"."${this.name}"`,
          values,
          opOptions,
        );
      } else {
        await clientQuery(
          client,
          `CREATE VIEW "${this.schema}"."${this.name}" AS ${sql}`,
          values,
          opOptions,
        );
      }
    });
  }

  async drop(options?: DropOptions) {
    const { cascade, ...opOptions } = options ?? {};
    await this.database.execute(
      `DROP VIEW ${options?.error ? '' : 'IF EXISTS'} "${this.schema}"."${this.name}" ${cascade ? 'CASCADE' : ''}`,
      opOptions,
    );
  }

  exists() {
    return this.database.viewExists(this);
  }
}
class MaterializedViewImpl<
    DB extends Database,
    EROW extends EntityRow<RowWithId>,
  >
  extends ViewImpl<DB, EROW>
  implements MaterializedView<DB, EROW>
{
  constructor(db: DB, entity: EntityDescription) {
    super(db, entity);
    this._materialized = true;
  }
  async refresh(options?: OperationOptions) {
    await this.database.execute((sql, _, { table: $table }) => {
      const v = $table(this);
      return sql`REFRESH MATERIALIZED VIEW ${v}`;
    }, options);
  }
}

// export type TableRow<T extends Table<any>> = T extends Table<infer ER> ? ER['output'] : never;
/**
 * Extracts the input (INSERT) row type from a `Table` or `View` entity.
 *
 * @example
 * ```ts
 * import type { TableInput } from 'oopg';
 *
 * const users = db.table<{ name: string }>('users');
 * type NewUser = TableInput<typeof users>; // { id?: string; name: string }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type TableInput<T extends DatabaseEntity<any>> =
  T extends Table<infer ER>
    ? ER['input']
    : T extends View<Database, infer ER>
      ? ER['input']
      : never;

/**
 * Extracts the output (SELECT) row type from a `Table` or `View` entity.
 *
 * @example
 * ```ts
 * import type { TableRow } from 'oopg';
 *
 * const users = db.table<{ name: string }>('users');
 * type UserRow = TableRow<typeof users>; // { id: string; name: string }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type TableRow<T extends DatabaseEntity<any>> =
  T extends Table<infer ER>
    ? ER['output']
    : T extends View<Database, infer ER>
      ? ER['output']
      : never;

/** TEST ZONE **

const fct = () => {};
const ofct = {} as NeatFunction<typeof fct>;
fct.caller;
// ofct()

// type ERTest = EntityRow<{ name: string }>;
// const ert = {} as ERTest;

// class TestDB extends Database {
// 	get test() {
// 		return this.table<{ name: string }>('test');
// 	}
// }

// type TestSQL = SQLDatabase<TestDB, true>;
// const tst = {} as TestSQL;
// tst.test.$format();

// tst.test;
/** END TEST ZONE */

// interface SQLEnvironment {
// 	select<R extends Row>(
// 		sql: string,
// 		valuesOrOptions?: any[] | OperationOptions | undefined,
// 		optionsWhenValues?: OperationOptions | undefined
// 	): Promise<R[]>;

// 	execute<R extends Row>(
// 		sql: string,
// 		valuesOrOptions?: any[] | OperationOptions | undefined,
// 		optionsWhenValues?: OperationOptions | undefined
// 	): ReturnType<typeof execute<R>>;

// 	cursor<R extends Row>(
// 		sql: string,
// 		valuesOrOptions?: any[] | CursorOptions | undefined,
// 		optionsWhenValues?: CursorOptions | undefined
// 	): Promise<Cursor<R>>;

// 	chunks<R extends Row>(
// 		sql: string,
// 		valuesOrCallback: any[] | ChunkCallback<R>,
// 		callbackOrOptions?: ChunkCallback<R> | ChunksOptions | undefined,
// 		optionsWhenValues?: ChunksOptions | undefined
// 	): Promise<void>;

// 	step<R extends Row>(
// 		sql: string,
// 		valuesOrCallback: any[] | StepCallback<R>,
// 		callbackOrOptions?: StepCallback<R> | StepOptions | undefined,
// 		optionsWhenValues?: StepOptions | undefined
// 	): Promise<void>;

// 	first<R extends Row>(
// 		sql: string,
// 		valuesOrOptions?: any[] | undefined,
// 		options?: CursorOptions | undefined
// 	): Promise<R | undefined>;
// }
