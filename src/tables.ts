import { PassThrough, Writable, type WritableOptions } from 'node:stream';
import { L } from '@lalex/console';
import type { ClientBase } from 'pg';
import { from } from 'pg-copy-streams';
import { DEFAULT_POSTGRES_SCHEMA } from './const';
import {
  type ColumnDefinition,
  type ComplexColumnDefinition,
  type EntityDescription,
  type ForeignKeyDefinition,
  type IDType,
  type IndexDefinition,
  isForeignKey,
  type OperationOptions,
  PGIDType,
  type Row,
  type RowWithId,
} from './types';
import {
  clientQuery,
  columnDefinitionToSQL,
  descriptionToEntity,
  formatEntity,
  valueToSQL,
} from './utils';

const LL = L.scope('oopg/tables');

type TableOperationOptions = OperationOptions;

type CreateIndexesOptions = TableOperationOptions & {
  drop?: boolean;
};

/**
 * Creates one or more indexes on a table.
 *
 * @param client - a `pg` client or pool client to execute against
 * @param table - table name or `{ name, schema }` descriptor
 * @param indexes - a single index definition or an array of index definitions
 * @param options - optional `drop` flag (default `true` — drops existing index before recreating) and debug options
 * @returns promise that resolves when all indexes have been created
 *
 * @example
 * ```ts
 * import { createIndexes } from 'oopg';
 *
 * await createIndexes(client, 'users', [
 *   { on: 'email', unique: true },
 *   { on: ['lastName', 'firstName'] },
 * ]);
 * ```
 */
export async function createIndexes<R extends Row = RowWithId>(
  client: ClientBase,
  table: EntityDescription,
  indexes: IndexDefinition<R> | IndexDefinition<R>[],
  options?: CreateIndexesOptions,
) {
  // options = { ...defaultCreateIndexOptions, ...options };
  const { drop = true, ...operationOptions } = options ?? {};

  const idxs = Array.isArray(indexes) ? indexes : [indexes];

  const { name } = descriptionToEntity(table);

  for (const index of idxs) {
    const indexDefinition = Array.isArray(index)
      ? { on: index }
      : typeof index === 'object'
        ? index
        : { on: index };
    LL.debug('Create index', indexDefinition);

    const indexColumns =
      indexDefinition.on !== undefined
        ? [indexDefinition.on].flat()
        : undefined;
    const indexName =
      indexDefinition.name ??
      `${name}_${indexColumns ? indexColumns.join('_') : ''}_IDX${indexDefinition.unique ? '_U' : ''}`;

    // const entityToSQL = formatEntity({ prefix: schema });

    const { where: indexConditions, options: indexOptions } = indexDefinition;

    const isUnique =
      typeof index === 'object' && 'unique' in index && !!index.unique;

    if (drop) {
      await clientQuery(
        client,
        `DROP INDEX IF EXISTS ${formatEntity(indexName)}`,
        operationOptions,
      );
    }
    const indexSQL = `CREATE ${isUnique ? 'UNIQUE' : ''} INDEX
            IF NOT EXISTS ${formatEntity(indexName)}
            ON ${formatEntity(table)} ${indexColumns ? `(${indexColumns.map((c) => `"${String(c)}"`).join(', ')})` : ''} ${
              indexConditions ? `WHERE ${indexConditions}` : ''
            } ${indexOptions ? `${indexOptions}` : ''}
        `;
    const result = await clientQuery(client, indexSQL, operationOptions);
    if (options?.debug) LL.debug('Index creation', result.rowCount);
  }
}

/**
 * Options for `alterColumn`. Set `required` to add/drop `NOT NULL`, and `default`
 * to set or drop the column default.
 */
export type AlterColumnOptions = OperationOptions & {
  required?: boolean;
  default?: ComplexColumnDefinition['default'] | null;
};

/**
 * Alters an existing column — sets or drops `NOT NULL` and/or the column default.
 *
 * @param client - a `pg` client to execute against
 * @param table - table name or `{ name, schema }` descriptor
 * @param column - column name to alter
 * @param options - `required` and/or `default` to set; pass `null` to drop the default
 * @returns promise that resolves when the ALTER TABLE statement completes
 *
 * @example
 * ```ts
 * import { alterColumn } from 'oopg';
 *
 * // Make column required and set a default
 * await alterColumn(client, 'users', 'status', { required: true, default: 'active' });
 *
 * // Drop the default
 * await alterColumn(client, 'users', 'status', { default: null });
 * ```
 */
export const alterColumn = async (
  client: ClientBase,
  table: EntityDescription,
  column: string,
  options: AlterColumnOptions,
) => {
  const { required, default: def, ...opOptions } = options ?? {};
  const alters: string[] = [];
  if (options?.required !== undefined) {
    alters.push(
      `ALTER COLUMN ${formatEntity(column)} ${options.required ? 'SET' : 'DROP'} NOT NULL`,
    );
  }
  if (options.default !== undefined) {
    alters.push(
      `ALTER COLUMN ${formatEntity('id')} ${
        options?.default === null
          ? 'DROP DEFAULT'
          : `SET DEFAULT ${typeof options.default === 'string' || typeof options.default === 'number' ? options.default : options.default['=']}`
      }`,
    );
  }
  if (alters.length) {
    await clientQuery(
      client,
      `ALTER TABLE ${formatEntity(table)} ${alters.join(', ')}`,
      opOptions,
    );
  }
};

/**
 * Column definitions map for `createTable`. The `id` key is reserved — the table
 * receives an auto-generated `id` column unless `withId: false` is set.
 */
export type CreateTableColumns<T extends Row = Row> = { id?: never } & {
  [K in keyof T as K extends 'id' ? never : K]-?: ColumnDefinition<
    NonNullable<T[K]>
  >;
};

/**
 * Options for `createTable`. Control `drop` (drop before recreate), `withId`
 * (auto id column), `temp` (temporary table), `indexes`, `foreignKeys`, and `checks`.
 */
export type CreateTableOptions<R extends Row = Row> = TableOperationOptions & {
  drop?: boolean;
  foreignKeys?: ForeignKeyDefinition<R>[];
  indexes?: IndexDefinition<R>[];
  checks?: string | string[];
  temp?: boolean;
  withId?: boolean | `nextval('${string}')${string}`;
};

/**
 * Creates a PostgreSQL table with the given column definitions.
 * Automatically creates a sequence-backed `id` column (unless `withId: false`),
 * drops and recreates the table if it already exists, and applies any `indexes`
 * and `foreignKeys` specified in `options`.
 *
 * @param client - a `pg` client to execute against
 * @param table - table name or `{ name, schema }` descriptor
 * @param columns - column definitions (keys map to column names; `id` is reserved)
 * @param options - optional drop/recreate, indexes, foreign keys, and debug options
 * @returns promise that resolves when the table and all associated objects have been created
 *
 * @example
 * ```ts
 * import { createTable, varchar, required, decimal, datetime } from 'oopg';
 *
 * await createTable(client, 'products', {
 *   name:      required(varchar(255)),
 *   price:     required(decimal(10, 2)),
 *   createdAt: datetime(),
 * });
 * ```
 */
export const createTable = async (
  client: ClientBase,
  table: EntityDescription,
  columns: CreateTableColumns,
  options?: CreateTableOptions,
) => {
  const { drop, indexes, foreignKeys, temp, ...operationOptions } =
    options ?? {};

  const { name, schema } = descriptionToEntity(table);

  const createInstructions = [
    // Columns definitions
    ...Object.entries(columns).map(
      ([name, c]) => `"${String(name)}" ${columnDefinitionToSQL(c)}`,
    ),
    // Checks
    ...(options?.checks
      ? typeof options.checks === 'string'
        ? [options.checks]
        : options.checks
      : []
    ).map((chk) => `CHECK (${chk})`),
  ];

  if (schema)
    await clientQuery(
      client,
      `CREATE SCHEMA IF NOT EXISTS "${schema}"`,
      operationOptions,
    );

  if (options?.withId === undefined || options?.withId === true) {
    const { assignTo: assignSequenceTo, nextSQL: sequenceNext } =
      await createTableSequence(client, {
        name: `${name}_id_seq`.toLowerCase(),
        schema: temp ? undefined : schema,
        ...operationOptions,
      });

    createInstructions.unshift(
      `"id" ${PGIDType} PRIMARY KEY NOT NULL DEFAULT ${sequenceNext}`,
    );

    await clientQuery(
      client,
      `DROP TABLE IF EXISTS ${formatEntity(table)} CASCADE`,
      operationOptions,
    );

    await clientQuery(
      client,
      `
					CREATE ${options?.temp ? 'TEMPORARY' : ''} TABLE IF NOT EXISTS ${formatEntity(temp ? name : table)} (
                        ${createInstructions.join(', ')}
                    )
				`,
      operationOptions,
    );

    await assignSequenceTo(table);
  } else if (options?.withId) {
    createInstructions.unshift(
      `"id" ${PGIDType} PRIMARY KEY NOT NULL DEFAULT ${options.withId}`,
    );

    await clientQuery(
      client,
      `DROP TABLE IF EXISTS ${formatEntity(table)} CASCADE`,
      operationOptions,
    );

    await clientQuery(
      client,
      `
					CREATE ${options?.temp ? 'TEMPORARY' : ''} TABLE IF NOT EXISTS ${formatEntity(temp ? name : table)} (
                        ${createInstructions.join(', ')}
                    )
				`,
      operationOptions,
    );
  } else {
    await clientQuery(
      client,
      `DROP TABLE IF EXISTS ${formatEntity(table)} CASCADE`,
      operationOptions,
    );

    // if (options?.withId) {
    // 	createInstructions.unshift(`"id" ${PGIDType} PRIMARY KEY NOT NULL DEFAULT ${options?.withId}`);
    // }

    await clientQuery(
      client,
      `
				CREATE ${options?.temp ? 'TEMPORARY' : ''} TABLE IF NOT EXISTS ${formatEntity(temp ? name : table)} (
					${createInstructions.join(', ')}
				)
			`,
      operationOptions,
    );
  }
  const tableIndexes: IndexDefinition[] = indexes ?? [];
  for (const [columnName, columnDef] of Object.entries(columns)) {
    if (typeof columnDef === 'object' && 'references' in columnDef) {
      const { references, ...refOptions } = columnDef;
      const refColums =
        typeof references === 'string' ? ['id'] : [references.column ?? 'id'];
      await addForeignKey(client, table, columnName, references, refColums, {
        ...options,
        ...refOptions,
      });
    }
  }
  if (tableIndexes.length) {
    LL.debug('Create indexes', tableIndexes);
    await createIndexes(client, table, tableIndexes, operationOptions);
  }
};

type DropTableOptions = TableOperationOptions & {
  cascade?: boolean;
};

/**
 * Drops a table from the database.
 *
 * @param client - a `pg` client to execute against
 * @param table - table name or `{ name, schema }` descriptor
 * @param options - optional `cascade` flag and debug options
 * @returns promise that resolves when the DROP TABLE statement completes
 *
 * @example
 * ```ts
 * import { dropTable } from 'oopg';
 *
 * await dropTable(client, 'temp_import', { cascade: true });
 * ```
 */
export async function dropTable(
  client: ClientBase,
  table: EntityDescription,
  options: DropTableOptions = {},
) {
  const { cascade, ...operationOptions } = options;
  // const entityToSQL = formatEntity({ prefix: schema });
  await clientQuery(
    client,
    `DROP TABLE ${formatEntity(table)} ${options?.cascade ? 'CASCADE' : ''}`,
    operationOptions,
  );
}

type ContraintReferentialAction = 'restrict' | 'cascade' | 'null';

/** Options for `addForeignKey`. Override constraint name, ON DELETE/UPDATE actions, and index creation. */
export type AddForeignKeyOptions = TableOperationOptions & {
  name?: string;
  onDelete?: ContraintReferentialAction;
  onUpdate?: ContraintReferentialAction;
  index?: boolean;
};

/**
 * Adds a foreign key constraint from a table column to another table.
 *
 * @param client - a `pg` client to execute against
 * @param table - source table name or `{ name, schema }` descriptor
 * @param keys - column(s) in the source table that hold the foreign key
 * @param references - target table name or `{ name, schema }` descriptor
 * @param columns - column(s) in the target table being referenced
 * @param options - optional constraint name, ON DELETE/UPDATE actions, and index flag
 * @returns promise that resolves when the constraint has been added
 *
 * @example
 * ```ts
 * import { addForeignKey } from 'oopg';
 *
 * await addForeignKey(client, 'posts', 'authorId', 'users', ['id'], {
 *   onDelete: 'cascade',
 * });
 * ```
 */
export async function addForeignKey(
  client: ClientBase,
  table: string | { name: string; schema?: string },
  keys: string | string[],
  references: string | { name: string; schema?: string },
  columns: string | string[],
  options: AddForeignKeyOptions = {},
) {
  const {
    name,
    onDelete = 'restrict',
    onUpdate = 'restrict',
    index = true,
    ...operationOptions
  } = options;

  const { name: tableName, schema: tableSchema } = descriptionToEntity(table);

  const foreignKeys = Array.isArray(keys) ? keys : [keys];

  const foreignTable =
    typeof references === 'object' ? references.name : references;
  const foreignSchema =
    typeof references === 'object' ? references.schema : tableSchema;
  const foreignColumns = Array.isArray(columns)
    ? columns
    : columns
      ? [columns]
      : ['id'];

  const refActionToSQL = (act: ContraintReferentialAction): string => {
    switch (act) {
      case 'null':
        return 'SET NULL';
      case 'cascade':
        return 'CASCADE';
      case 'restrict':
        return 'RESTRICT';
    }
  };

  const foreignKeyName =
    name ??
    `${tableName}_${keys}_REF_${foreignSchema !== tableSchema ? `${foreignSchema}_` : ''}${foreignTable}_${foreignColumns.join('_')}_FK`;

  await clientQuery(
    client,
    `
			ALTER TABLE ${formatEntity(table)}
				ADD CONSTRAINT "${foreignKeyName}"
				FOREIGN KEY (${foreignKeys.map((key) => formatEntity(key)).join(',')}) REFERENCES ${formatEntity(
          {
            name: foreignTable,
            schema: foreignSchema,
          },
        )}(${foreignColumns.map((column) => formatEntity(column)).join(',')})
				ON DELETE ${refActionToSQL(onDelete)} ON UPDATE ${refActionToSQL(onUpdate)}
		`,
    operationOptions,
  );

  if (index)
    await createIndexes(
      client,
      table,
      { on: keys, name: `${foreignKeyName}_IDX` },
      operationOptions,
    );
}

type CreateTableSequenceOptions = Omit<
  CreateTableOptions,
  'indexes' | 'withId'
> & { name?: string; schema?: string };

async function createTableSequence(
  client: ClientBase,
  options: CreateTableSequenceOptions = {},
) {
  LL.debug('createTableSequence', options);
  const { drop, temp, name, schema, ...operationOptions } = options;

  // const entityToSQL = formatEntity({ prefix: options?.schema });

  const sequence = {
    name:
      name ??
      `seq_${new Date().getTime()}_${Math.random().toString().slice(2, 6)}`,
    schema: options?.schema,
  };

  if (sequence.schema)
    await clientQuery(
      client,
      `CREATE SCHEMA IF NOT EXISTS "${sequence.schema}"`,
      operationOptions,
    );

  await clientQuery(
    client,
    `DROP SEQUENCE IF EXISTS ${formatEntity(sequence)} CASCADE`,
    operationOptions,
  );

  await clientQuery(
    client,
    `CREATE ${temp ? 'TEMPORARY' : ''} SEQUENCE IF NOT EXISTS ${formatEntity(sequence)}`,
    operationOptions,
  );

  return {
    name: sequence.name,
    schema: sequence.schema,
    nextSQL: `nextval('${formatEntity(sequence)}')::${PGIDType}`,
    assignTo: async (table: EntityDescription, column?: string) => {
      return assignSequenceToTable(client, sequence, table, {
        ...operationOptions,
        column,
      });
    },
  };
}

type AssignSequenceOptions = TableOperationOptions & {
  column?: string;
};
async function assignSequenceToTable(
  client: ClientBase,
  sequence: EntityDescription,
  table: EntityDescription | null,
  options?: AssignSequenceOptions,
) {
  let sequenceOwner = 'NONE';
  const { name: sequenceName, schema: sequenceSchema } =
    descriptionToEntity(sequence);
  const { column = 'id', ...operationOptions } = options ?? {};
  if (table !== null) {
    const { name: tableName, schema: tableSchema } = descriptionToEntity(table);
    if (tableSchema && sequenceSchema && tableSchema !== sequenceSchema)
      throw new Error(
        'assigned table must be in the same schema as the sequence',
      );
    sequenceOwner = `${formatEntity({ schema: tableSchema, name: tableName, column })}`;
  }
  // const entityToSQL = formatEntity({ prefix: tableSchema });
  try {
    return clientQuery(
      client,
      `ALTER SEQUENCE ${formatEntity(sequence)}
                OWNED BY ${sequenceOwner}`,
      operationOptions,
    );
  } catch (e) {
    await new Promise((res) => setTimeout(res, 1000));
    throw e;
  }
}

type InsertTableOptions = TableOperationOptions & {
  full?: boolean;
};

/**
 * Inserts one or more rows into a table using `INSERT ... RETURNING`.
 *
 * @param client - a `pg` client to execute against
 * @param table - table name or `{ name, schema }` descriptor
 * @param data - a single row object or an array of row objects to insert
 * @param options - optional `full` flag (return full rows instead of ids) and debug options
 * @returns array of inserted `id` values by default; full row objects when `full: true`
 *
 * @example
 * ```ts
 * import { insertIntoTable } from 'oopg';
 *
 * const ids = await insertIntoTable(client, 'users', [
 *   { name: 'Alice', email: 'alice@example.com' },
 *   { name: 'Bob',   email: 'bob@example.com' },
 * ]);
 * console.log('inserted ids:', ids);
 * ```
 */
export function insertIntoTable<
  ROW extends Row,
  O extends { full: true } & Omit<InsertTableOptions, 'full'>,
>(
  client: ClientBase,
  table: EntityDescription,
  data: ROW[],
  options?: O,
): Promise<ROW[]>;
export function insertIntoTable<ROW extends Row>(
  client: ClientBase,
  table: EntityDescription,
  data: ROW[],
  options?: InsertTableOptions,
): Promise<IDType[]>;
export function insertIntoTable<
  ROW extends Row,
  O extends { full: true } & Omit<InsertTableOptions, 'full'>,
>(
  client: ClientBase,
  table: EntityDescription,
  data: ROW,
  options?: O,
): Promise<IDType[]>;
export function insertIntoTable<ROW extends Row>(
  client: ClientBase,
  table: EntityDescription,
  data: ROW,
  options?: InsertTableOptions,
): Promise<IDType[]>;
export async function insertIntoTable<ROW extends Row = Row>(
  client: ClientBase,
  table: EntityDescription,
  data: ROW | ROW[],
  options?: InsertTableOptions,
) {
  if (Array.isArray(data) && !data.length) return [];
  const datas = Array.isArray(data) ? data : [data];

  const fields = [...new Set(datas.flatMap((d) => Object.keys(d)))];
  const values = datas.flatMap((d) =>
    fields.map((f) => (f in d ? d[f] : null)),
  );

  const { full, ...operationOptions } = options ?? {};

  // const tableToSQL = formatEntity({ prefix: options?.schema });
  // const columnToSQL = formatEntity();

  const insertSQL = `
		INSERT INTO ${formatEntity(table)} (${fields.map((f) => formatEntity(f))})
		VALUES ${datas
      .map(
        (_, dataIndex) =>
          `(${fields.map((_, fieldIndex) => `$${fields.length * dataIndex + fieldIndex + 1}`)})`,
      )
      .join(',')}
		RETURNING ${options?.full ? '*' : formatEntity('id')}
	`;

  const insertResult = await clientQuery<RowWithId>(
    client,
    insertSQL,
    values,
    operationOptions,
  );

  if (Array.isArray(data)) {
    return full ? insertResult.rows : insertResult.rows.map((r) => r.userId);
  }
  return full ? insertResult.rows.shift() : insertResult.rows.shift()?.userId;
}

type CopyToOptions<ROW extends Row = Row> = WritableOptions & {
  columns?: (keyof ROW & string)[];
  format?: 'text' | 'csv';
};
async function copyToTable(
  client: ClientBase,
  table: EntityDescription,
  options?: TableOperationOptions & CopyToOptions,
) {
  const { debug, columns, format = 'csv', ...writeOptions } = options ?? {};
  // const tableToSQL = formatEntity({ prefix: schema });
  // const columnToSQL = formatEntity();
  const copySQL = `
		COPY ${formatEntity(table)} ${columns?.length ? `(${columns.map((c) => formatEntity(c))})` : ''}
		FROM STDIN ${format}
	`;
  // if (debug) LL.debug('Create stream with', writeOptions);
  const stream = clientQuery(client, from(copySQL, writeOptions));
  if (options?.debug || process.env.OOPG_SHOW_SQL === 'true') {
    let readData = 0;
    const debugStream = new PassThrough();
    LL.debug('[COPY]', copySQL);
    stream.on('error', (e) =>
      LL.error('Error on COPY stream', copySQL, e.message),
    );
    debugStream.on('data', (d) => readData++);
    debugStream.pipe(stream);
    const spin = LL.debug.spin(`Data read in COPY ${readData}`);
    const spinInterval = setInterval(
      () => spin.update(`Data read in COPY ${readData}`),
      1_000,
    );
    stream.on('finish', () => {
      clearInterval(spinInterval);
      spin.success(`Data read in COPY ${readData}`);
    });
    return debugStream;
  }
  return stream;
}

/**
 * Returns all table names in the specified schema (or all user schemas if omitted).
 *
 * @param client - a `pg` client to execute against
 * @param schema - optional schema name to filter by
 * @returns array of `{ name, schema }` objects
 *
 * @example
 * ```ts
 * import { getAllTables } from 'oopg';
 *
 * const tables = await getAllTables(client, 'public');
 * console.log(tables.map(t => t.name));
 * ```
 */
export async function getAllTables(client: ClientBase, schema?: string) {
  const allTables = await clientQuery<{ name: string; schema: string }>(
    client,
    `
			SELECT schemaname AS "schema", tablename AS "name"
			FROM pg_catalog.pg_tables
			WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
				${schema ? `AND schemaname = ${valueToSQL(schema)}` : ''}
				
		`,
  );
  return allTables.rows;
}

/**
 * Returns all view names in the specified schema (or all user schemas if omitted).
 *
 * @param client - a `pg` client to execute against
 * @param schema - optional schema name to filter by
 * @returns array of `{ name, schema }` objects
 */
export async function getAllViews(client: ClientBase, schema?: string) {
  const allTables = await clientQuery<{ name: string; schema: string }>(
    client,
    `
			SELECT schemaname AS "schema", viewname AS "name"
			FROM pg_catalog.pg_views
			WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
				${schema ? `AND schemaname = ${valueToSQL(schema)}` : ''}
				
		`,
  );
  return allTables.rows;
}

/**
 * Checks whether a table exists in the database.
 *
 * @param client - a `pg` client to execute against
 * @param table - table name or `{ name, schema }` descriptor
 * @returns `true` if the table exists, `false` otherwise
 *
 * @example
 * ```ts
 * import { tableExists } from 'oopg';
 *
 * if (!(await tableExists(client, 'users'))) {
 *   await createTable(client, 'users', { name: required(varchar(100)) });
 * }
 * ```
 */
export async function tableExists(
  client: ClientBase,
  table: EntityDescription,
) {
  const { name, schema } = descriptionToEntity(table);
  const hasTable = await clientQuery(
    client,
    `
            SELECT 1
            FROM pg_catalog.pg_tables
            WHERE tablename = ${valueToSQL(name)}
                AND schemaname = ${valueToSQL(schema ?? DEFAULT_POSTGRES_SCHEMA)}
                
        `,
  );
  return !!hasTable.rowCount;
}

/**
 * Checks whether a view exists in the database.
 *
 * @param client - a `pg` client to execute against
 * @param table - view name or `{ name, schema }` descriptor
 * @returns `true` if the view exists, `false` otherwise
 */
export async function viewExists(client: ClientBase, table: EntityDescription) {
  const { name, schema } = descriptionToEntity(table);
  const hasTable = await clientQuery(
    client,
    `
            SELECT 1
            FROM pg_catalog.pg_views
            WHERE viewname = ${valueToSQL(name)}
                AND schemaname = ${valueToSQL(schema ?? DEFAULT_POSTGRES_SCHEMA)}
                
        `,
  );
  return !!hasTable.rowCount;
}

/**
 * Options for `tableOutput`. Control table creation, fixed columns, foreign key
 * transformation, column renaming, and bulk write behavior.
 */
export type TableOutputOptions<ROW extends Row = Row> = Pick<
  CreateTableOptions,
  keyof TableOperationOptions | 'drop' | 'withId' | 'indexes'
> & {
  create?: boolean;
  fixed?: Record<string, ColumnDefinition>;
  transform?: {
    data?: (o: Record<string, unknown>) => ROW;
    foreignKeys?: Record<
      string,
      {
        match: Record<
          string,
          string | { table: EntityDescription; column: string; is: string }
        >;
        table: EntityDescription;
        keep?: boolean;
      }
    >;
    rename?: Record<string, string>;
  };
  temp?: boolean;
  data?: boolean;
} & BulkWriteOptions;

/**
 * Creates a streaming output pipeline that collects rows into a temporary table,
 * then materializes the result as a final permanent table (with optional id column,
 * foreign key joins, and index creation).
 *
 * @param client - a `pg` client to execute against
 * @param table - destination table name or `{ name, schema }` descriptor
 * @param options - optional create, transform, fixed columns, and bulk write options
 * @returns `{ enqueue, close }` — call `enqueue(rows)` to stream data in, then `close()` to finalize
 *
 * @example
 * ```ts
 * import { tableOutput } from 'oopg';
 *
 * const { enqueue, close } = tableOutput(client, 'import_results');
 * for (const batch of dataBatches) {
 *   enqueue(batch);
 * }
 * await close();
 * ```
 */
export function tableOutput<ROW extends Row = Row>(
  client: ClientBase,
  table: EntityDescription,
  options?: TableOutputOptions<ROW>,
) {
  const {
    create = true,
    drop,
    fixed = {},
    transform,
    withId = true,
    indexes = [],
    data,
    temp,
    ...bulkWriteOptions
  } = options ?? {};

  const useTempTemp = !options?.debug;

  const { name: tableName, schema: tableSchema } = descriptionToEntity(table);

  const tempTable = {
    name: `__temp${new Date().getTime()}${Math.round(Math.random() * 100)}_${tableName}`,
    schema: useTempTemp ? undefined : tableSchema,
  };

  let insertColumns: string[] | undefined;
  const tableDefinition = {
    ...Object.fromEntries(
      Object.entries(fixed).map(([col, def]) => [
        col,
        isForeignKey(def) ? PGIDType : def,
      ]),
    ),
  };

  let createPromise: Promise<unknown> | undefined;
  let enqueueCount = 0;

  // const entityToSQL = formatEntity({ prefix: options?.schema });
  // const columnToSQL = formatEntity();

  const { enqueue: bulkEnqueue, close: bulkClose } = bulkWrite(
    client,
    tempTable,
    bulkWriteOptions,
  );

  const enqueueFunction = (data: ROW | ROW[]) => {
    let datas = Array.isArray(data) ? [...data] : [data];
    if (transform?.data) {
      const transData = transform.data;
      datas = datas.map((d) => transData(d));
    }
    if (!createPromise) {
      if (create) {
        insertColumns = [
          ...new Set(
            datas
              .slice(0, 10)
              .flatMap((d) => Object.keys(d))
              .concat(Object.keys(fixed)),
          ),
        ];
        for (const dat of datas.slice(0, 10)) {
          for (const col of insertColumns) {
            if (fixed[col] !== undefined) continue;
            const dataValue = dat[col];
            switch (true) {
              case dataValue instanceof Date:
                tableDefinition[col] = 'timestamptz';
                break;
              case Array.isArray(dataValue) && !options?.jsonArray:
                tableDefinition[col] = ['text'];
                break;
              case typeof dataValue === 'number':
                tableDefinition[col] = 'decimal';
                break;
              case typeof dataValue === 'bigint':
                tableDefinition[col] = 'bigint';
                break;
              case typeof dataValue === 'boolean':
                tableDefinition[col] = 'boolean';
                break;
              case typeof dataValue === 'object':
                tableDefinition[col] = 'jsonb';
                break;
              default:
                tableDefinition[col] ??= 'text';
                break;
            }
          }
        }
        createPromise = createTable(client, tempTable, tableDefinition, {
          ...bulkWriteOptions,
          withId: false,
          // TODO: Set table a temp if not debug mode
          temp: useTempTemp,
        });
      } else {
        createPromise = Promise.resolve();
      }
    }
    const enqueueDatas = [...datas];
    if (!(data ?? true) && enqueueCount) return;
    enqueueCount += datas.length;
    createPromise.then(() => bulkEnqueue(enqueueDatas));
  };

  const closeFunction = async () => {
    if (!createPromise) return;

    // Wait for bulk write to finish
    await createPromise.then(() => bulkClose());

    const finalTableColumnsSQL: string[] = [];
    let finalTableFromSQL = formatEntity(tempTable);

    const unkeptColumns = new Set<string>();

    const sequence =
      (withId ?? true) === true
        ? await createTableSequence(client, {
            name: `${tableName}_id_seq`.toLowerCase(),
            schema: tableSchema,
            drop,
            ...bulkWriteOptions,
          })
        : undefined;

    if (sequence) {
      finalTableColumnsSQL.push(`${sequence.nextSQL} AS ${formatEntity('id')}`);
    } else if (options?.withId && typeof options?.withId === 'string') {
      finalTableColumnsSQL.push(`${options?.withId} AS ${formatEntity('id')}`);
    }

    let aliasIndex = 0;
    for (const [fkColumn, fkParams] of Object.entries(
      transform?.foreignKeys ?? {},
    )) {
      const { match: fkMatch, table: fkTable, keep } = fkParams;
      if (!Object.keys(fkMatch).length)
        throw new Error('Foreign key must have at least one match field');
      const { name: fTargetName, schema: fkTargetSchema } =
        descriptionToEntity(fkTable);
      const foreignTarget = {
        table: fkTable,
        alias: `${fTargetName}_${++aliasIndex}`,
        ons: [] as string[],
      };

      // const foreignToSQL = formatEntity({ prefix: fkSchema ?? schema });

      // Add columns to SELECT
      // if (!keep) for (const k of Object.keys(fkMatch)) unkeptColumns.add(k);

      // Add joins to FROM

      for (const [column, fkColumn] of Object.entries(fkMatch)) {
        if (!keep) unkeptColumns.add(column);
        if (typeof fkColumn === 'string') {
          foreignTarget.ons.push(
            `${formatEntity({ ...tempTable, column })} = ${formatEntity({
              name: foreignTarget.alias,
              column: fkColumn,
            })}`,
          );
        } else {
          const {
            table: foreignTable,
            column: foreignColumn,
            is: targetColumn,
          } = fkColumn;
          const { name: foreignTableName } = descriptionToEntity(foreignTable);

          const foreignTableAlias = `${foreignTableName}_${++aliasIndex}`;

          finalTableFromSQL += ` LEFT OUTER JOIN ${formatEntity(foreignTable)} AS "${foreignTableAlias}"
                                        ON ${formatEntity({ ...tempTable, column })}
                                            = ${formatEntity({ name: foreignTableAlias, column: foreignColumn })}`;
          foreignTarget.ons.push(
            `${formatEntity({ name: foreignTarget.alias, column: targetColumn })}
                        = ${formatEntity({ name: foreignTableAlias, column: 'id' })}`,
          );
        }
      }

      finalTableColumnsSQL.push(
        `${formatEntity({ name: foreignTarget.alias, column: 'id' })} AS ${formatEntity(fkColumn)}`,
      );

      finalTableFromSQL += ` LEFT OUTER JOIN ${formatEntity(foreignTarget.table)} AS "${
        foreignTarget.alias
      }" ON ${foreignTarget.ons.join(' AND ')}`;
    }

    // Add other non excluded columns
    finalTableColumnsSQL.push(
      ...(insertColumns
        ?.filter((c) => !unkeptColumns.has(c))
        .map((c) => {
          let columnSQL = `${formatEntity({ ...tempTable, column: c })}`;
          if (transform?.rename?.[c])
            columnSQL += ` AS ${formatEntity(transform.rename[c])}`;
          return columnSQL;
        }) ?? []),
    );

    await clientQuery(
      client,
      `
				CREATE TABLE ${formatEntity(table)} AS
				SELECT ${finalTableColumnsSQL}
				FROM ${finalTableFromSQL}
				${!(data ?? true) ? 'WITH NO DATA' : ''}
			`,
      bulkWriteOptions,
    );

    const tableAlters: string[] = [];

    if (sequence) {
      tableAlters.push(
        `ALTER COLUMN ${formatEntity('id')} SET DEFAULT ${sequence.nextSQL}`,
        `ALTER COLUMN ${formatEntity('id')} SET NOT NULL`,
        `ADD PRIMARY KEY (${formatEntity('id')})`,
      );
    } else if (options?.withId && typeof options?.withId === 'string') {
      tableAlters.push(
        `ALTER COLUMN ${formatEntity('id')} SET DEFAULT ${options?.withId}`,
        `ALTER COLUMN ${formatEntity('id')} SET NOT NULL`,
        `ADD PRIMARY KEY (${formatEntity('id')})`,
      );
    }

    for (const [fixedColumn, fixedDefinition] of Object.entries(fixed)) {
      if (
        !Array.isArray(fixedDefinition) &&
        typeof fixedDefinition === 'object'
      ) {
        if ('required' in fixedDefinition) {
          tableAlters.push(
            `ALTER COLUMN ${formatEntity(fixedColumn)} SET NOT NULL`,
          );
        }
        if ('default' in fixedDefinition) {
          tableAlters.push(
            `ALTER COLUMN ${formatEntity(fixedColumn)} SET DEFAULT ${
              typeof fixedDefinition.default === 'string' ||
              typeof fixedDefinition.default === 'number'
                ? valueToSQL(fixedDefinition.default)
                : fixedDefinition.default?.['=']
            }`,
          );
        }
      }
    }

    if (tableAlters.length) {
      await clientQuery(
        client,
        `
					ALTER TABLE ${formatEntity(table)}
					${tableAlters.join(',\r\n')}
				`,
        bulkWriteOptions,
      );
    }
    sequence?.assignTo(table, 'id');

    await Promise.all([
      ...Object.entries(transform?.foreignKeys ?? {}).map(
        ([fkColumn, fkParams]) => {
          const { table: fkTable } = fkParams;
          return addForeignKey(
            client,
            table,
            fkColumn,
            fkTable,
            ['id'],
            bulkWriteOptions,
          );
        },
      ),
      ...Object.entries(fixed).map(([col, def]) => {
        if (isForeignKey(def))
          return addForeignKey(
            client,
            table,
            col,
            def.references,
            typeof def.references === 'string'
              ? ['id']
              : [def.references.column ?? 'id'],
          );
        return Promise.resolve();
      }),
    ]);

    await createIndexes(client, table, indexes, bulkWriteOptions);
  };

  return { enqueue: enqueueFunction, close: closeFunction };
}

type ValueToCSVOptions = {
  jsonArray?: boolean;
};
const valueToCSV = (val: unknown, options?: ValueToCSVOptions) => {
  const quote = (str: string) => `"${str.replaceAll('"', '""')}"`;

  if (val === undefined || val === null) return '';
  if (val instanceof Date) return quote(val.toISOString());
  if (Array.isArray(val) && !options?.jsonArray)
    return quote(
      `{${val.map((v) => {
        const sql = `${valueToSQL(v, false)}`;
        return sql;
      })}}`,
    );
  if (typeof val === 'object') return quote(JSON.stringify(val));

  return quote(`${val}`);
};

/** Options for `createTableObjectStream`. Includes column selection, format, and flush interval. */
export type CreateTableWriteStreamOptions<ROW extends Row = Row> =
  TableOperationOptions & CopyToOptions<ROW> & { flush?: number };

/**
 * Creates a writable object stream for streaming rows into a table via PostgreSQL's COPY protocol.
 * Write row objects or arrays to the stream; data is flushed to the table in batches.
 *
 * @param client - a `pg` client to execute against
 * @param table - table name or `{ name, schema }` descriptor
 * @param options - optional column selection, format, flush interval, and debug options
 * @returns a `Writable` stream in object mode
 *
 * @example
 * ```ts
 * import { createTableObjectStream } from 'oopg';
 *
 * const stream = await createTableObjectStream(client, 'events');
 * for (const row of rows) {
 *   stream.write(row);
 * }
 * stream.end();
 * ```
 */
export async function createTableObjectStream(
  client: ClientBase,
  table: EntityDescription,
  options?: CreateTableWriteStreamOptions,
) {
  const { flush: flushDelay = 200 } = options ?? {};

  const lines: string[] = [];
  let flushTimeout: ReturnType<typeof setTimeout> | undefined;
  const tst = new Writable({
    objectMode: true,
    autoDestroy: false,
    write(chunk, encoding, callback) {
      if (!flushTimeout) flushTimeout = setTimeout(flush, flushDelay);
      lines.push(
        (Array.isArray(chunk) ? chunk : [chunk])
          .map((v) => valueToCSV(v))
          .join(','),
      );
      callback();
    },
    writev(chunks, callback) {
      if (!flushTimeout) flushTimeout = setTimeout(flush, flushDelay);
      lines.push(
        ...chunks.map((c) => {
          return `${(Array.isArray(c.chunk) ? c.chunk : [c.chunk]).map((v) => valueToCSV(v)).join(',')}`;
        }),
      );
      callback();
    },
  });

  const flush = () => {
    const csvLines = lines.join('\r\n');
    lines.length = 0;
    flushTimeout = undefined;
    copyToTable(client, table, options).then((str) => {
      str.write(csvLines);
      str.end();
    });
  };

  // const trans = new PassThrough({
  // 	// autoDestroy: false,
  // 	writableObjectMode: true,
  // 	writableHighWaterMark: 1,
  // 	transform(chunk, encoding, callback) {
  // 		const data = Array.isArray(chunk) ? chunk : [chunk];
  // 		const csv = `${data.map((v) => valueToCSV(v)).join(',')}`;
  // 		callback(null, csv);
  // 	},
  // });

  // const writ = await copyToTable(client, table, { ...options, highWaterMark: 1, autoDestroy: false });

  // trans.pipe(writ);

  return tst;
}

/** Options for `bulkWrite`. Controls debug output and JSON array serialization. */
export type BulkWriteOptions = TableOperationOptions & ValueToCSVOptions;

/**
 * Writes rows to a table using PostgreSQL's COPY protocol for high-throughput bulk loading.
 * Returns `{ enqueue, close }` — call `enqueue(rows)` to buffer rows, then `close()` to
 * flush and finalize.
 *
 * @param client - a `pg` client to execute against
 * @param table - table name or `{ name, schema }` descriptor
 * @param options - optional debug and JSON array options
 * @returns `{ enqueue, close }` controller
 *
 * @example
 * ```ts
 * import { bulkWrite } from 'oopg';
 *
 * const { enqueue, close } = bulkWrite(client, 'large_table');
 * for (const batch of getBatches()) {
 *   enqueue(batch);
 * }
 * await close();
 * ```
 */
export function bulkWrite<ROW extends Row = Row>(
  client: ClientBase,
  table: EntityDescription,
  options?: BulkWriteOptions,
) {
  const { ...operationOptions } = options ?? {};
  const { debug } = operationOptions;

  let lineCount = 0;

  let insertColumns: string[] | undefined;
  let enqueueCount = 0;

  let streamPromise: Promise<Writable> | undefined;

  let bulkResolve: () => void;
  let bulkReject: (err?: unknown) => void;
  const bulkPromise = new Promise<void>((res, rej) => {
    bulkResolve = res;
    bulkReject = rej;
  });

  const enqueueFunction = (data: ROW | ROW[]) => {
    const datas = Array.isArray(data) ? data : [data];
    enqueueCount += datas.length;

    if (!streamPromise) {
      insertColumns ??= [...new Set(datas.flatMap((d) => Object.keys(d)))];

      streamPromise = copyToTable(client, table, {
        ...operationOptions,
        columns: insertColumns,
        format: 'csv',
      }).then((stream) =>
        stream
          .on('finish', () => bulkResolve())
          .on('error', (e: unknown) => bulkReject(e)),
      );
    }
    const enqueueDatas = [...datas];
    streamPromise.then((str) => {
      const END_LINE = '\r\n';
      const csvString = enqueueDatas
        .map((lineData, lineIndex) => {
          const line = insertColumns
            ?.map((lineColum) => valueToCSV(lineData[lineColum], options))
            .join(',');
          if (debug && !lineIndex && !lineCount) {
            LL.notice('First line', line);
          }
          lineCount++;
          return line;
        })
        .join(END_LINE);

      str.write(csvString + END_LINE);
    });
  };

  const closeFunction = async () => {
    if (streamPromise) {
      // if (debug) L.notice('Wait for stream promise');
      const stream = await streamPromise;
      // if (debug) L.notice('Stream promises done');
      stream.end();
      // if (debug) L.notice('Wait for bulk promise');
      await bulkPromise;
      // if (debug) L.notice('Bulk promise done');
      return;
    }
    return Promise.resolve();
  };

  return { enqueue: enqueueFunction, close: closeFunction };
}

/** Test zone */

/** **/
