// import { L } from '@lalex/console';
import { L } from '@lalex/console';
import type { U } from 'ts-toolbelt';
import { DEFAULT_POSTGRES_SCHEMA } from './const';
import {
  Database,
  type DatabaseElement,
  type Func,
  isFunc,
  isTable,
  isView,
  type MaterializedView,
  type Schema,
  type Table,
  type TableRow,
  type View,
} from './database';
import type { EntityDescription, JSType, PGType, Row } from './types';
import { columnTypeToSQL, descriptionToEntity } from './utils';

const LL = L.scope('sql');
// LL.enabled = false;

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type AllKeys<T> = T extends any ? keyof T : never;

/**
 * Tagged template function returned by `createSQLContext`. Accepts a template literal
 * with interpolated values and returns `{ sql, values }` for use in parameterized queries.
 * The result is also callable as `(alias) => SQLQuery` to wrap it as a named subquery.
 */
export type SQLTemplate = (
  strings: TemplateStringsArray,
  ...params: unknown[]
) => { sql: string; values: unknown[]; (alias: string): void };

/**
 * Represents a Common Table Expression (CTE) definition. Provides `.alias()` to set
 * the CTE name, `.use()` to produce the `WITH` clause entry, and typed column accessors
 * for referencing the CTE in subsequent query fragments.
 */
export type SQLCTEDefinition<T = Record<string, unknown>> = {
  alias(name: string): SQLCTEDefinition<T>;
  use(materialized?: boolean): SQLQuery;
} & Record<keyof T, void>;

/**
 * Tagged template function that creates a CTE definition from a SQL fragment.
 * Returns an `SQLCTEDefinition` that can be aliased and consumed in a `WITH` clause.
 */
export type SQLCTE = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...params: unknown[]
) => SQLCTEDefinition<T>;

/**
 * Maps a `Database` subclass's schema entities (tables, views, functions, sub-schemas)
 * to their SQL-template counterparts. This is the type of `tables` inside `db.sql`.
 * When `STRICT` is `true`, only declared schema keys are accessible; when `false`,
 * unknown string keys fall back to untyped table references.
 */
type SQLTables<DB extends Database, STRICT extends boolean = true> = {
  // Table/View Properties
  [TK in keyof DB as DB[TK] extends DatabaseElement | Schema
    ? TK
    : never]-?: TK extends keyof DB
    ? DB[TK] extends Table<infer ER>
      ? SQLTable<ER['output'], STRICT>
      : // biome-ignore lint/suspicious/noRedeclare: <explanation>
        DB[TK] extends View<DB, infer VR> | MaterializedView<DB, infer VR>
        ? SQLSelect<VR['output'], STRICT>
        : DB[TK] extends Func<DB, infer ARGS>
          ? SQLFunction<ARGS>
          : DB[TK] extends Schema
            ? {
                [SK in keyof DB[TK]]: DB[TK][SK] extends Table<infer ER>
                  ? SQLTable<ER['output'], STRICT>
                  : DB[TK][SK] extends
                        | View<DB, infer ER>
                        // biome-ignore lint/suspicious/noRedeclare: <explanation>
                        | MaterializedView<DB, infer ER>
                    ? SQLSelect<ER['output'], STRICT>
                    : DB[TK][SK] extends Func<DB, infer ARGS>
                      ? SQLFunction<ARGS>
                      : never;
              } & (STRICT extends false
                ? { [key: string]: SQLTable<Record<string, unknown>, false> }
                : Record<string, never>)
            : never
    : never;
} & (STRICT extends false
  ? { [key: string]: SQLTable<Record<string, unknown>, false> }
  : Record<string, never>);

/**
 * SQL template representation of a table. Extends `SQLSelect` with write-side helpers:
 * `$insert` produces an INSERT target with an optional column list, and `$update`
 * produces a SET clause from a key-value object.
 */
type SQLTable<T extends Row, STRICT extends boolean> = {
  $insert: SQLFormat<
    (...args: AllKeys<T>[]) => SQLFormat<void, TableFormatOptions>,
    TableFormatOptions
  >;
  $update: (sets: Partial<Record<AllKeys<T>, unknown>>) => void;
} & SQLSelect<T, STRICT>;

/**
 * SQL template representation of a selectable entity (table or view). Provides `$all`
 * for `table.*`, `$select` for a named column list with optional aliases, `$columns`
 * for a bare column list (no table prefix), and per-column accessors returning `SQLColumn`.
 */
type SQLSelect<T extends Row, STRICT extends boolean> = SQLAlias<
  SQLFormat<
    {
      $all: SQLFormat<void, ColumnFormatOptions>;
      $select: (
        ...columnsOrAliases: (
          | AllKeys<T>
          | Partial<Record<AllKeys<T>, string | boolean>>
        )[]
      ) => SQLFormat<void, ColumnFormatOptions>;
      $columns: (
        ...columnsOrAliases: AllKeys<T>[]
      ) => SQLFormat<void, ColumnFormatOptions>;
    } & {
      // Table / View columns
      [C in AllKeys<T> | (string & {}) as STRICT extends false
        ? C
        : C extends AllKeys<T>
          ? C
          : never]: SQLColumn<U.Strict<T>[C]>;
    },
    TableFormatOptions
  >
>;

/**
 * SQL template representation of a stored function. Callable with typed arguments;
 * returns an aliasable SQL fragment representing the function call expression.
 */
type SQLFunction<ARGS extends (PGType | [PGType])[]> = (
  ...args: SQLFunctionParams<ARGS>
) => SQLAlias<SQLFormat<void, TableFormatOptions>>;

/**
 * Maps a function's `PGType` argument definitions to their JavaScript equivalents.
 * Variadic arguments (wrapped in a tuple `[PGType]`) become rest arrays of SQL params.
 */
type SQLFunctionParams<ARGS extends (PGType | [PGType])[]> = {
  [K in keyof ARGS]: ARGS[K] extends PGType
    ? JSType<ARGS[K]> | SQLParam<JSType<ARGS[K]>>
    : ARGS[K] extends [infer T]
      ? T extends PGType
        ? SQLParam<JSType<T>>[]
        : never
      : never;
};

/**
 * Union of JavaScript types accepted as interpolated parameters inside SQL template literals.
 * Covers all primitives, arrays, dates, and nested `SQLQuery` subqueries.
 */
type SQLParam<_T = unknown> =
  | string
  | number
  | boolean
  | null
  | Date
  | unknown[]
  | SQLQuery;

type TableFormatOptions = { schema?: boolean; quote?: boolean };

type ColumnFormatOptions = TableFormatOptions & { table?: boolean };
// type SQLColumn<T> = SQLAlias<SQLFormat<(alias?: string) => SQLFormat<void, ColumnFormatOptions>, ColumnFormatOptions>> &
//     (T extends object ? { [key in keyof T]: SQLAlias<{ $cast: (type: PGType) => void }> } : {});

/**
 * SQL template representation of a single column. Supports aliasing via `$format`,
 * PostgreSQL type casting via `$cast`, and JSON field extraction via sub-property
 * access (e.g., `col.field` produces `col->>'field'`). When `T` is an object type,
 * each key is also exposed as a typed JSON field accessor.
 */
type SQLColumn<T> = (T extends object
  ? {
      [K in AllKeys<T>]: SQLAlias<
        SQLCast<SQLFormat<void, ColumnFormatOptions>>
      >;
    } & {
      name: SQLAlias<SQLCast<SQLFormat<void, ColumnFormatOptions>>>;
    }
  : T extends unknown
    ? {
        [k: string]: SQLAlias<SQLCast<SQLFormat<void, ColumnFormatOptions>>>;
      } & {
        name: SQLAlias<SQLCast<SQLFormat<void, ColumnFormatOptions>>>;
      }
    : unknown) &
  SQLAlias<SQLCast<SQLFormat<void, ColumnFormatOptions>>>;

/**
 * Makes a value both directly usable as a SQL fragment and callable with an optional
 * alias: `value` produces the raw SQL; `value('alias')` produces `... AS "alias"`.
 */
type SQLAlias<T = void> = T & ((alias?: string) => T);

/**
 * Adds a `$format(options)` method to any SQL fragment, allowing the caller to control
 * schema inclusion, identifier quoting, and table-prefix behavior at call site.
 */
type SQLFormat<
  T = void,
  O extends Record<string, unknown> = Record<string, never>,
  R = void,
> = {
  $format: (options?: O) => R;
} & T;

/**
 * Adds a `$cast(type)` method to any SQL fragment for applying a PostgreSQL type cast
 * (e.g., `$cast('int4')` appends `::int4` to the generated SQL).
 */
type SQLCast<T> = T & { $cast: (type: PGType) => T };

const DEFAULT_TABLE_FORMAT: TableFormatOptions = { schema: true, quote: true };
const DEFAULT_COLUMN_FORMAT: ColumnFormatOptions = {
  ...DEFAULT_TABLE_FORMAT,
  table: true,
};
const DEFAULT_FUNCTION_FORMAT: FunctionFormatOptions = {
  ...DEFAULT_TABLE_FORMAT,
};

// Internal symbols used by the proxy system:
// CallableProp — marks a function as proxy-interceptable; when encountered during template interpolation it is invoked to get the SQL fragment.
// SQLProp     — carries the pre-built SQL string on format objects so the template engine can inline it without adding a parameter placeholder.
// ValuesProp  — carries the parameter values array alongside a SQL fragment.
const CallableProp = Symbol('callableProperty');
const SQLProp = Symbol('sqlProperty');
const ValuesProp = Symbol('valuesProperty');

/**
 * The core query shape produced by SQL template literals: a parameterized SQL string
 * and the corresponding ordered values array ready for `pg` to bind as `$1, $2, ...`.
 */
export type SQLQuery = { sql: string; values: unknown[] };

/**
 * Type guard that checks whether a value is an `SQLQuery` (has both `sql` and `values`
 * properties). Used during template interpolation to detect nested subqueries.
 */
const isQuery = (val: unknown): val is SQLQuery => {
  return (
    !!val &&
    (typeof val === 'function' || typeof val === 'object') &&
    'sql' in val &&
    'values' in val
  );
};

/**
 * Core template literal handler for building parameterized SQL queries. Processes a
 * tagged template string, converting each interpolated value into a numbered `$N`
 * placeholder (or inlining pre-built SQL fragments) and collecting the bound values.
 * The returned `SQLQuery` is also callable as `(alias) => SQLQuery` for use as a
 * named subquery (`(SELECT ...) AS "alias"`).
 */
const sqlTaggedTemplate = (strings: string[], ...params: unknown[]) => {
  let sql = '';
  const values: unknown[] = [];
  let valueIndex = 1;
  for (let position = 0; position < strings.length; position++) {
    sql += strings[position];
    if (params[position] !== undefined) {
      let paramValue = params[position];
      let paramString = '';
      if (
        typeof paramValue === 'function' &&
        Object.hasOwn(paramValue, CallableProp)
      ) {
        paramValue = paramValue();
      }
      switch (true) {
        // Null literal — pass through as parameterized value
        case paramValue === null:
          values.push(null);
          paramString = `$${valueIndex++}`;
          break;
        // SQL fragment from a format function — inline the pre-built SQL string
        case paramValue !== null &&
          typeof paramValue === 'object' &&
          SQLProp in paramValue &&
          typeof paramValue[SQLProp] === 'string':
          paramString = paramValue[SQLProp];
          break;
        // Subquery — renumber its $N placeholders to avoid collisions and merge values
        case isQuery(paramValue):
          {
            paramString = paramValue.sql.replaceAll(
              /\$(\d+)/gm,
              (_, position) =>
                `$${Number.parseInt(position, 10) + values.length}`,
            );
            values.push(...paramValue.values);
            valueIndex += paramValue.values.length;
          }
          break;
        // Boolean — cast explicitly to avoid implicit pg coercion
        case typeof paramValue === 'boolean':
          values.push(paramValue);
          paramString = `$${valueIndex++}::boolean`;
          break;
        // Date — convert to ISO string with timestamptz cast
        case paramValue instanceof Date:
          values.push(paramValue.toISOString());
          paramString = `$${valueIndex++}::timestamptz`;
          break;
        // Number — cast to numeric
        case typeof paramValue === 'number':
          values.push(paramValue);
          paramString = `$${valueIndex++}::numeric`;
          break;
        // String or array — pass as-is (pg handles binding)
        case typeof paramValue === 'string':
        case Array.isArray(paramValue):
          values.push(paramValue);
          paramString = `$${valueIndex++}`;
          break;
        // Plain object — serialize to JSON with jsonb cast
        case typeof paramValue === 'object':
          values.push(JSON.stringify(paramValue));
          paramString = `$${valueIndex++}::jsonb`;
          break;

        default:
          throw new Error(
            'SQL template parameter must be a primitive, Date, array, or SQL fragment — objects are not allowed to prevent injection',
          );
      }
      sql += paramString;
    }
  }
  return Object.assign(
    (alias: string) => {
      return { sql: `(${sql}) AS "${alias}"`, values };
    },
    { sql, values },
  );
};

const tableFormatFunction =
  (table: EntityDescription, options?: { alias?: string }) =>
  (format?: TableFormatOptions) => {
    return {
      [SQLProp]: formatTable(table, format, options),
    };
  };

const columnListFunction =
  (
    table: EntityDescription,
    tableAlias?: string,
    defaultFormat?: ColumnFormatOptions,
  ) =>
  (...columnOrAliases: FormatColumnParameter[]) => {
    return Object.assign(
      columnFormatFunction(table, columnOrAliases, { tableAlias })(
        defaultFormat,
      ),
      {
        $format: (format: ColumnFormatOptions) =>
          columnFormatFunction(table, columnOrAliases, { tableAlias })({
            ...defaultFormat,
            ...format,
          }),
      },
    );
  };

const insertFormatFunction =
  (table: EntityDescription, columns: Record<string, true>) =>
  (options?: ColumnFormatOptions) => {
    const tableSQL = tableFormatFunction(table)(options)[SQLProp];
    const columnsSQL = Object.keys(columns).length
      ? ` (${columnFormatFunction(table, columns)({ ...options, table: false, schema: false })[SQLProp]})`
      : '';
    return { [SQLProp]: `${tableSQL}${columnsSQL}` };
  };

const formatTable = (
  table: EntityDescription,
  format: TableFormatOptions = DEFAULT_TABLE_FORMAT,
  options?: { alias?: string },
) => {
  const { name, schema } = descriptionToEntity(table);
  let sql = format?.quote ? `"${name}"` : name;
  if (format?.schema)
    sql =
      (format?.quote
        ? `"${schema ?? DEFAULT_POSTGRES_SCHEMA}".`
        : `${schema ?? DEFAULT_POSTGRES_SCHEMA}.`) + sql;
  if (options?.alias)
    sql += ` AS ${format?.quote ? `"${options.alias}"` : options.alias}`;
  return sql;
};

type FunctionFormatOptions = TableFormatOptions;

const formatFunc = (
  func: EntityDescription,
  format: FunctionFormatOptions = DEFAULT_FUNCTION_FORMAT,
  options?: { alias?: string },
) => {
  return (
    formatTable(func, format) +
    (options?.alias ? ` AS ${quote(options.alias, format)}` : '')
  );
};

const formatFuncCall = (
  func: EntityDescription,
  args: number,
  format: FunctionFormatOptions = DEFAULT_FUNCTION_FORMAT,
  options?: { alias?: string },
) => {
  const fmt = { ...DEFAULT_FUNCTION_FORMAT, ...format };
  LL.debug(
    args,
    '=>',
    args > 0 ? new Array(args - 1).fill(null).map(() => ', ') : [],
  );
  return [
    `${formatTable(func, fmt)}(`,
    ...(args > 0 ? new Array(args - 1).fill(null).map(() => ', ') : []),
    `)${options?.alias ? ` AS ${quote(options.alias, fmt)}` : ''}`,
  ];
};

type FormatColumnParameter = string | Record<string, string | boolean>;

const quote = (str: string, options?: { quote?: boolean }) => {
  return options?.quote ? `"${str}"` : str;
};

const formatColumn = (
  table: EntityDescription,
  column: string,
  format: ColumnFormatOptions,
  options?: { alias?: string; cast?: PGType | [PGType] } & (
    | { prefix?: string }
    | { tableAlias?: string }
  ),
) => {
  const fmt = { ...DEFAULT_COLUMN_FORMAT, ...format };
  let prefix = '';
  if (options) {
    switch (true) {
      case 'prefix' in options && !!options.prefix:
        prefix = options.prefix;
        break;
      case 'tableAlias' in options && !!options.tableAlias:
        prefix = quote(options.tableAlias ?? '', fmt);
        break;
      case fmt.table:
        prefix = formatTable(table, fmt);
        break;
    }
  }
  if (column === '*') return prefix ? `${prefix}.*` : '*';

  let sql = prefix ? `${prefix}.` : '';
  sql += quote(column, fmt);
  if (options?.cast) sql += `::${columnTypeToSQL(options.cast)}`;
  if (options?.alias) sql += ` AS ${quote(options.alias, fmt)}`;
  return sql;
};

type FormatColumnOptions = { tableAlias?: string; cast?: PGType | [PGType] };

const formatColumns = (
  table: EntityDescription,
  columns: FormatColumnParameter | FormatColumnParameter[],
  format: ColumnFormatOptions = DEFAULT_COLUMN_FORMAT,
  options?: FormatColumnOptions,
) => {
  const fmt = { ...DEFAULT_COLUMN_FORMAT, ...format };
  const cols = Array.isArray(columns) ? [...columns] : [columns];

  const columnsSql: string[] = [];

  const prefix = options?.tableAlias
    ? quote(options.tableAlias, fmt)
    : fmt.table
      ? formatTable(table, fmt, { alias: options?.tableAlias })
      : undefined;

  for (const column of cols) {
    if (typeof column === 'string') {
      columnsSql.push(formatColumn(table, column, fmt, { prefix }));
    } else {
      for (const [col, alias] of Object.entries(column)) {
        if (typeof alias === 'string') {
          columnsSql.push(
            formatColumn(table, col, fmt, { ...options, prefix, alias }),
          );
        } else if (alias) {
          columnsSql.push(
            formatColumn(table, col, fmt, { ...options, prefix }),
          );
        }
      }
    }
  }

  return columnsSql.join(', ');
};

const formatColumnField = (
  table: EntityDescription,
  column: string,
  field: string,
  format?: ColumnFormatOptions,
  options?: { alias?: string; cast?: PGType | [PGType]; tableAlias?: string },
) => {
  const fmt = { ...DEFAULT_COLUMN_FORMAT, ...format };
  let prefix = '';
  if (options) {
    switch (true) {
      case !!options.tableAlias:
        prefix = quote(options.tableAlias ?? '', fmt);
        break;
      case fmt.table:
        prefix = formatTable(table, fmt);
        break;
    }
  }

  let sql = prefix ? `${prefix}.` : '';
  sql += quote(column, fmt);
  sql += `->>'${String(field)}'`;
  if (options?.cast) sql = `(${sql})::${columnTypeToSQL(options.cast)}`;
  if (options?.alias) sql += ` AS ${quote(options.alias, fmt)}`;
  return sql;
};

const columnFormatFunction =
  (
    table: EntityDescription,
    columns: FormatColumnParameter | FormatColumnParameter[],
    options?: FormatColumnOptions,
  ) =>
  (format?: ColumnFormatOptions) => {
    return {
      [SQLProp]: formatColumns(table, columns, format, options),
    };
  };

const columnFieldFormatFunction =
  (
    table: EntityDescription,
    column: string,
    field: string,
    options?: FormatColumnOptions & { alias?: string },
  ) =>
  (format?: ColumnFormatOptions) => {
    return {
      [SQLProp]: formatColumnField(table, column, field, format, options),
    };
  };

/**
 * Marks a function as proxy-interceptable by attaching the `CallableProp` symbol.
 * When the SQL template engine encounters a value that has `CallableProp` during
 * interpolation, it invokes the function first to obtain the SQL fragment before
 * processing the result.
 */
const callable = <F extends () => unknown>(
  fct: F,
  additional?: Record<string, unknown>,
): F => {
  return Object.assign(fct, { ...additional, [CallableProp]: true });
};

/**
 * Proxy handler that intercepts property access on table/view references inside SQL
 * templates. Each property access on a table (e.g., `tables.users.name`) resolves to
 * a formatted SQL column reference. Special `$`-prefixed properties provide table-level
 * SQL operations:
 *   - `$insert` — INSERT target with optional column list
 *   - `$update` — SET clause fragments from a key-value object
 *   - `$format` — formatted table name with schema/quote control
 *   - `$select` — column list with optional aliases
 *   - `$columns` — bare column list (no table prefix)
 *   - `$all`    — `table.*` or just `*`
 */
const tableProxyHandler = (tb: EntityDescription, tableAlias?: string) => {
  return {
    get: <T>(o: T, column: keyof T) => {
      switch (column) {
        // Returns an INSERT target: `schema.table (col1, col2)` with optional column list
        case '$insert':
          return Object.assign(
            (...columns: string[]) =>
              Object.assign(
                insertFormatFunction(
                  tb,
                  Object.fromEntries(columns.map((c) => [c, true])),
                )(),
                {
                  $format: insertFormatFunction(
                    tb,
                    Object.fromEntries(columns.map((c) => [c, true])),
                  ),
                },
              ),
            { $format: insertFormatFunction(tb, {}) },
          );
        // Returns SET clause fragments: `col1 = $1, col2 = $2` from a key-value object
        case '$update':
          return (
            sets: Record<string, unknown>,
            options?: Omit<ColumnFormatOptions, 'table' | 'schema'>,
          ) => {
            return sqlTaggedTemplate(
              [...Object.keys(sets)].map(
                (k, i) =>
                  `${i ? ', ' : ''}${formatColumn(tb, k, { ...options, table: false })} = `,
              ),
              ...Object.values(sets).map((sets) =>
                isQuery(sets) ? { ...sets, sql: `(${sets.sql})` } : sets,
              ),
            );
          };
        // Returns the table's formatted SQL name with configurable schema/quoting
        case '$format':
          return tableFormatFunction(tb, { alias: tableAlias });
        // Returns a column list from selected column names with optional aliases
        case '$select':
          return columnListFunction(tb, tableAlias);
        // Returns a column list without table prefix (for INSERT column lists)
        case '$columns':
          return columnListFunction(tb, tableAlias, { table: false });
        // Returns `table.*` or just `*` depending on format options
        case '$all':
          return callable(columnFormatFunction(tb, '*', { tableAlias }), {
            $format: columnFormatFunction(tb, '*', { tableAlias }),
          });
        // Internal symbol access — pass through to underlying object
        case SQLProp:
        case ValuesProp:
        case CallableProp:
          return o[column];
        // Column access — returns a proxy that resolves to a formatted column reference.
        // The returned value is both callable (for aliasing: `col('alias')`) and a proxy
        // itself (for JSON field access: `col.field` and casting: `col.$cast('int4')`).
        default:
          if (typeof column !== 'string') return;
          return callable(
            new Proxy(
              (alias?: string) =>
                Object.assign(
                  columnFormatFunction(
                    tb,
                    { [column]: alias ?? true },
                    { tableAlias },
                  )(),
                  {
                    $format: columnFormatFunction(
                      tb,
                      { [column]: alias ?? true },
                      { tableAlias },
                    ),
                    $cast: Object.assign(
                      (type: NonNullable<FormatColumnOptions['cast']>) =>
                        Object.assign(
                          columnFormatFunction(
                            tb,
                            { [column]: alias ?? true },
                            { tableAlias, cast: type },
                          )(),
                          {
                            $format: columnFormatFunction(
                              tb,
                              { [column]: alias ?? true },
                              { tableAlias, cast: type },
                            ),
                          },
                        ),
                    ),
                  },
                ),
              {
                get: <T>(tgt: T, field: keyof T) => {
                  if (tgt[field as keyof typeof tgt])
                    return tgt[field as keyof typeof tgt];
                  // Handles sub-properties of a column reference: `$cast` for type casting,
                  // `$format` for output control, and string keys for JSON field access (`column->>'field'`).
                  switch (field) {
                    case '$cast':
                      return Object.assign(
                        (type: NonNullable<FormatColumnOptions['cast']>) =>
                          Object.assign(
                            columnFormatFunction(tb, [field], {
                              tableAlias,
                              cast: type,
                            })(),
                            {
                              $format: columnFormatFunction(tb, [field], {
                                tableAlias,
                                cast: type,
                              }),
                            },
                          ),
                      );
                    case '$format':
                      return columnFormatFunction(tb, [field], { tableAlias });
                    default:
                      if (typeof field !== 'string') return tgt[field];
                      return callable(
                        (alias?: string) =>
                          Object.assign(
                            columnFieldFormatFunction(tb, column, field, {
                              tableAlias,
                              alias,
                            })(),
                            {
                              $cast: (type: PGType | [PGType]) =>
                                Object.assign(
                                  columnFieldFormatFunction(tb, column, field, {
                                    tableAlias,
                                    alias,
                                    cast: type,
                                  })(),
                                  {
                                    $format: columnFieldFormatFunction(
                                      tb,
                                      column,
                                      field,
                                      {
                                        tableAlias,
                                        alias,
                                        cast: type,
                                      },
                                    ),
                                  },
                                ),
                              $format: columnFieldFormatFunction(
                                tb,
                                column,
                                field,
                                {
                                  tableAlias,
                                  alias,
                                },
                              ),
                            },
                          ),
                        {
                          $cast: (type: PGType | [PGType]) =>
                            Object.assign(
                              columnFieldFormatFunction(tb, column, field, {
                                tableAlias,
                                cast: type,
                              })(),
                              {
                                $format: columnFieldFormatFunction(
                                  tb,
                                  column,
                                  field,
                                  {
                                    tableAlias,
                                    cast: type,
                                  },
                                ),
                              },
                            ),
                          $format: columnFieldFormatFunction(
                            tb,
                            column,
                            field,
                            {
                              tableAlias,
                            },
                          ),
                        },
                      );
                  }
                },
              },
            ),
            {
              $format: columnFormatFunction(
                tb,
                { [column]: true },
                { tableAlias },
              ),
            },
          );
      }
    },
  };
};

/**
 * Creates the SQL context object used by `Database.sql()` template literals.
 * Returns `{ sql, tables, utils }` where:
 *   - `sql`    is the tagged template handler for building parameterized queries
 *   - `tables` is a type-safe proxy that maps database schema entities to SQL fragments
 *   - `utils`  provides helper functions: `raw`, `table`, `cte`, `type`, `and`, `array`
 *
 * The `strict` flag controls whether unknown property access on `tables` falls back to
 * an untyped table reference (`false`) or is silently ignored (`true`).
 */
export const createSQLContext = <DB extends Database, STRICT extends boolean>(
  db: Database,
  strict = false,
) => {
  const tablesProxy = new Proxy(
    {},
    {
      get(_, dbProp) {
        const dbField = db[dbProp as keyof typeof db];
        let dbEntity: EntityDescription | undefined;
        switch (true) {
          // Database function — return a callable that produces `schema.func_name(args)` SQL
          case dbField !== undefined && isFunc(dbField):
            return new Proxy((...args: unknown[]) => {
              return callable(
                (alias?: string) => {
                  const strings = formatFuncCall(
                    dbField,
                    args.length,
                    undefined,
                    { alias },
                  );
                  return Object.assign(sqlTaggedTemplate(strings, ...args), {
                    $format: (format: FunctionFormatOptions) => {
                      const strings = formatFuncCall(
                        dbField,
                        args.length,
                        format,
                        { alias },
                      );
                      return sqlTaggedTemplate(strings, ...args);
                    },
                  });
                },
                {
                  $format: (format: FunctionFormatOptions) => {
                    const strings = formatFuncCall(
                      dbField,
                      args.length,
                      format,
                    );
                    return sqlTaggedTemplate(strings, ...args);
                  },
                },
              );
            }, {});
          // Sub-schema — return a nested proxy that resolves schema.entity references
          case dbField !== undefined && Database.isSchema(dbField):
            return new Proxy(dbField, {
              get: <T, P extends keyof T>(schemaObject: T, schemaProp: P) => {
                const schemaField = schemaObject[schemaProp];
                let schemaEntity: EntityDescription | undefined;
                switch (true) {
                  case schemaField !== undefined && isFunc(schemaField):
                    return new Proxy((...args: unknown[]) => {
                      return callable(
                        (alias?: string) => {
                          const strings = formatFuncCall(
                            schemaField,
                            args.length,
                            undefined,
                            {
                              alias,
                            },
                          );
                          return Object.assign(
                            sqlTaggedTemplate(strings, ...args),
                            {
                              $format: (format: FunctionFormatOptions) => {
                                const strings = formatFuncCall(
                                  schemaField,
                                  args.length,
                                  format,
                                  {
                                    alias,
                                  },
                                );
                                return sqlTaggedTemplate(strings, ...args);
                              },
                            },
                          );
                        },
                        {
                          $format: (format: FunctionFormatOptions) => {
                            const strings = formatFuncCall(
                              schemaField,
                              args.length,
                              format,
                            );
                            return sqlTaggedTemplate(strings, ...args);
                          },
                        },
                      );
                    }, {});
                  // Table or view — wrap in tableProxyHandler for column/operation access
                  case schemaField !== undefined &&
                    (isTable(schemaField) || isView(schemaField)):
                    schemaEntity = schemaObject[
                      schemaProp
                    ] as EntityDescription;
                    break;
                  // Loose mode — treat unknown properties as untyped table references
                  case typeof schemaProp === 'string' && !strict:
                    schemaEntity = {
                      schema: `${String(dbProp)}`,
                      name: `${String(schemaProp)}`,
                    };
                    break;
                }
                if (schemaEntity) {
                  return new Proxy(
                    callable(
                      (alias?: string) =>
                        new Proxy(
                          tableFormatFunction(schemaEntity, { alias })(),
                          tableProxyHandler(schemaEntity, alias),
                        ),
                    ),
                    tableProxyHandler(schemaEntity),
                  );
                }
              },
            });
          // Table or view — wrap in tableProxyHandler for column/operation access
          case dbField !== undefined && (isTable(dbField) || isView(dbField)):
            dbEntity = db[dbProp as keyof typeof db] as EntityDescription;
            break;
          // Loose mode — treat unknown properties as untyped table references
          case typeof dbProp === 'string' && !strict:
            dbEntity = {
              name: `${String(dbProp)}`,
              // biome-ignore lint/suspicious/noExplicitAny: <explanation>
              schema: (db.constructor as any).DEFAULT_SCHEMA,
            };
            break;
        }
        if (dbEntity) {
          return new Proxy(
            callable(
              (alias?: string) =>
                new Proxy(
                  tableFormatFunction(dbEntity, { alias })(),
                  tableProxyHandler(dbEntity, alias),
                ),
            ),
            tableProxyHandler(dbEntity),
          );
        }
      },
    },
  ) as SQLTables<DB, STRICT>;

  let cteAliasIndex = 0;

  return {
    sql: sqlTaggedTemplate as unknown as SQLTemplate,
    tables: tablesProxy,
    utils: {
      /** Injects a raw SQL string without parameterization. Use with caution — values are NOT escaped. */
      raw: (str: unknown) => {
        return { sql: `${str}`, values: [] };
      },
      /** Creates a table proxy from an `EntityDescription`, enabling column access outside the schema. */
      table: ((table: EntityDescription) => {
        const tbl = descriptionToEntity(table);
        return new Proxy(
          callable(
            (alias?: string) =>
              new Proxy(
                tableFormatFunction(tbl, { alias })(),
                tableProxyHandler(tbl, alias),
              ),
          ),
          tableProxyHandler(tbl),
        );
      }) as {
        <Entity extends EntityDescription = EntityDescription>(
          name: Entity,
        ): Entity extends Table<infer R>
          ? SQLTable<TableRow<Entity>, true>
          : SQLTable<Record<string, unknown>, false>;
        <RowType extends Record<string, unknown>>(
          name: EntityDescription,
        ): SQLTable<RowType, true>;
      },
      /** Defines a Common Table Expression (WITH clause). Returns a proxy with `.alias()`, `.use()`, and column accessors for referencing the CTE inside queries. */
      cte: ((strings: string[], ...params: unknown[]) => {
        const cteQuery = sqlTaggedTemplate(strings, ...params);
        // let isDefinition = true;
        let cteAlias = `cte_${cteAliasIndex++}`;
        const func = callable(
          () => {
            return { [SQLProp]: `"${cteAlias}"` };
          },
          // {
          // 	alias(name: string) {
          // 		cteAlias = name;
          // 		return this;
          // 	},
          // 	materialize: (materialized: boolean, alias?: string) => {
          // 		if (!isDefinition) throw new Error('CTE should be defined once');
          // 		cteAlias ??= alias ?? `cte${cteAliasIndex++}`;
          // 		isDefinition = false;
          // 		return {
          // 			sql: `"${cteAlias}" AS ${materialized ? 'MATERIALIZED' : 'NOT MATERIALIZED'} (
          //                 ${cteQuery.sql}
          //             )`,
          // 			values: cteQuery.values,
          // 		};
          // 	},
          // },
        );
        const cteProxy = new Proxy(func, {
          get<T extends object>(pxy: T, prop: keyof T) {
            switch (true) {
              case prop in pxy:
                return pxy[prop];
              case prop === 'alias':
                return (name: string) => {
                  cteAlias = name;
                  return cteProxy;
                };
              case prop === 'from':
                return { [SQLProp]: `"${cteAlias}"` };
              case prop === 'use':
                return (materialized?: boolean) => {
                  return {
                    sql: `"${cteAlias}" AS${materialized !== undefined ? (materialized ? ' MATERIALIZED' : ' NOT MATERIALIZED') : ''} (${cteQuery.sql.trim()})`,
                    values: cteQuery.values,
                  };
                };
              case typeof prop === 'string':
                return callable(() => {
                  // L.debug(`Get CTE column ${prop} in ${cteAlias}`);
                  return { [SQLProp]: `"${cteAlias}"."${prop}"` };
                });
              default:
                throw new Error(`Invalid CTE property ${String(prop)}`);
            }
          },
        });
        return cteProxy;
      }) as unknown as SQLCTE,
      /** Returns a SQL type cast fragment (e.g., `int4`, `text[]`) for use in template interpolation. */
      type: (type: PGType | [PGType]) => {
        return { [SQLProp]: columnTypeToSQL(type) } as unknown;
      },
      /** Joins multiple `SQLQuery` fragments with AND, renumbering parameter placeholders to avoid collisions. */
      and: (...queries: SQLQuery[]) => {
        const andSql: string[] = [];
        const andValues: unknown[] = [];
        queries.forEach(({ sql, values }, index) => {
          andSql.push(
            index
              ? sql.replaceAll(
                  /\$(\d+)/gm,
                  (_, position) =>
                    `$${Number.parseInt(position, 10) + andValues.length}`,
                )
              : sql,
          );
          andValues.push(...values);
        });
        return { sql: andSql.join(' AND '), values: andValues };
      },
      /** Converts a JavaScript array to a `jsonb` literal for use in SQL templates. */
      array: (o: unknown[]) => {
        return { sql: `'${JSON.stringify(o)}'::jsonb`, values: [] };
      },
    },
  };
};
