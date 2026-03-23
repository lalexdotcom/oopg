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

export type SQLTemplate = (
  strings: TemplateStringsArray,
  ...params: unknown[]
) => { sql: string; values: unknown[]; (alias: string): void };

export type SQLCTEDefinition<T = Record<string, unknown>> = {
  // (alias?: string): void;
  alias(name: string): SQLCTEDefinition<T>;
  use(materialized?: boolean): void;
} & Record<keyof T, void>;

export type SQLCTE = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...params: unknown[]
) => SQLCTEDefinition<T>;

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

type SQLTable<T extends Row, STRICT extends boolean> = {
  $insert: SQLFormat<
    (...args: AllKeys<T>[]) => SQLFormat<void, TableFormatOptions>,
    TableFormatOptions
  >;
  $update: (sets: Partial<Record<AllKeys<T>, unknown>>) => void;
} & SQLSelect<T, STRICT>;

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

type SQLFunction<ARGS extends (PGType | [PGType])[]> = (
  ...args: SQLFunctionParams<ARGS>
) => SQLAlias<SQLFormat<void, TableFormatOptions>>;

type SQLFunctionParams<ARGS extends (PGType | [PGType])[]> = {
  [K in keyof ARGS]: ARGS[K] extends PGType
    ? JSType<ARGS[K]> | SQLParam<JSType<ARGS[K]>>
    : ARGS[K] extends [infer T]
      ? T extends PGType
        ? SQLParam<JSType<T>>[]
        : never
      : never;
};

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

type SQLAlias<T = void> = T & ((alias?: string) => T);
type SQLFormat<
  T = void,
  O extends Record<string, unknown> = Record<string, never>,
  R = void,
> = {
  $format: (options?: O) => R;
} & T;
type SQLCast<T> = T & { $cast: (type: PGType) => T };

const DEFAULT_TABLE_FORMAT: TableFormatOptions = { schema: true, quote: true };
const DEFAULT_COLUMN_FORMAT: ColumnFormatOptions = {
  ...DEFAULT_TABLE_FORMAT,
  table: true,
};
const DEFAULT_FUNCTION_FORMAT: FunctionFormatOptions = {
  ...DEFAULT_TABLE_FORMAT,
};

const CallableProp = Symbol('callableProperty');
const SQLProp = Symbol('sqlProperty');
const ValuesProp = Symbol('valuesProperty');

export type SQLQuery = { sql: string; values: unknown[] };

const isQuery = (val: unknown): val is SQLQuery => {
  return (
    !!val &&
    (typeof val === 'function' || typeof val === 'object') &&
    'sql' in val &&
    'values' in val
  );
};

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
        case paramValue === null:
          values.push(null);
          paramString = `$${valueIndex++}`;
          break;
        // Param is a decription
        case paramValue !== null &&
          typeof paramValue === 'object' &&
          SQLProp in paramValue &&
          typeof paramValue[SQLProp] === 'string':
          paramString = paramValue[SQLProp];
          break;
        // Param value is a subquery
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
        // Param is a value
        case typeof paramValue === 'boolean':
          values.push(paramValue);
          paramString = `$${valueIndex++}::boolean`;
          break;
        case paramValue instanceof Date:
          values.push(paramValue.toISOString());
          paramString = `$${valueIndex++}::timestamptz`;
          break;
        case typeof paramValue === 'number':
          values.push(paramValue);
          paramString = `$${valueIndex++}::numeric`;
          break;
        case typeof paramValue === 'string':
        case Array.isArray(paramValue):
          values.push(paramValue);
          paramString = `$${valueIndex++}`;
          break;

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

const callable = <F extends () => unknown>(
  fct: F,
  additional?: Record<string, unknown>,
): F => {
  return Object.assign(fct, { ...additional, [CallableProp]: true });
};

const tableProxyHandler = (tb: EntityDescription, tableAlias?: string) => {
  return {
    get: <T>(o: T, column: keyof T) => {
      switch (column) {
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
        case '$format':
          return tableFormatFunction(tb, { alias: tableAlias });
        case '$select':
          return columnListFunction(tb, tableAlias);
        case '$columns':
          return columnListFunction(tb, tableAlias, { table: false });
        case '$all':
          return callable(columnFormatFunction(tb, '*', { tableAlias }), {
            $format: columnFormatFunction(tb, '*', { tableAlias }),
          });
        case SQLProp:
        case ValuesProp:
        case CallableProp:
          return o[column];
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
                  case schemaField !== undefined &&
                    (isTable(schemaField) || isView(schemaField)):
                    schemaEntity = schemaObject[
                      schemaProp
                    ] as EntityDescription;
                    break;
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
          case dbField !== undefined && (isTable(dbField) || isView(dbField)):
            dbEntity = db[dbProp as keyof typeof db] as EntityDescription;
            break;
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
      raw: (str: unknown) => {
        return { sql: `${str}`, values: [] };
      },
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
                    sql: `"${cteAlias}" AS ${
                      materialized !== undefined
                        ? materialized
                          ? 'MATERIALIZED'
                          : 'NOT MATERIALIZED'
                        : ''
                    } (
											${cteQuery.sql}
										)`,
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
      type: (type: PGType | [PGType]) => {
        return { [SQLProp]: columnTypeToSQL(type) } as unknown;
      },
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
      array: (o: unknown[]) => {
        return { sql: `'${JSON.stringify(o)}'::jsonb`, values: [] };
      },
    },
  };
};
