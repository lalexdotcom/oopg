import type { types as _pgTypes } from 'pg';
import type { AddForeignKeyOptions } from './tables';
/** Union of all built-in PostgreSQL type names (e.g. 'INT8', 'NUMERIC'). Use with the Database constructor `types` option to override type parsers per pool. */
export type PGTypeName = keyof typeof _pgTypes.builtins;

/**
 * PostgreSQL column type descriptor. A string type name, a complex type with
 * precision/scale, or a foreign key reference.
 *
 * @example
 * ```ts
 * // Plain string type
 * const col: PGType = 'text';
 *
 * // Precise varchar
 * const nameCol: PGType = { type: 'varchar', precision: 255 };
 *
 * // Decimal with scale
 * const priceCol: PGType = { type: 'decimal', precision: 10, scale: 2 };
 * ```
 */
export type PGType<T = unknown> = T extends number | bigint
  ? PGNumericType
  : T extends string
    ? PGTextType
    : T extends boolean
      ? PGBooleanType
      : T extends Date
        ? PGDateType
        :
            | PGDateType
            | PGTextType
            | PGNumericType
            | PGObjectType
            | PGBooleanType;

type PGDateType = 'timestamptz' | 'date';
type PGTextType = 'text' | Precise<'varchar'>;
type PGNumericType =
  | 'smallint'
  | 'int'
  | 'bigint'
  | Scale<'numeric'>
  | Scale<'decimal'>
  | Precise<'float'>;
type PGObjectType = 'json' | 'jsonb';
type PGBooleanType = 'boolean';

/**
 * Defines a varchar column with optional maximum character length.
 *
 * @param precision - maximum character length; omit for unbounded text
 * @returns a varchar column type descriptor
 *
 * @example
 * ```ts
 * import { createTable, varchar, required } from 'oopg';
 *
 * await createTable(client, 'users', {
 *   name: required(varchar(100)),
 *   bio:  varchar(500),
 * });
 * ```
 */
export const varchar = (precision?: number) =>
  ({ type: 'varchar', precision }) as const;

/**
 * Defines a decimal column with optional precision and scale.
 *
 * @param precision - total number of significant digits
 * @param scale - number of digits after the decimal point
 * @returns a decimal column type descriptor
 *
 * @example
 * ```ts
 * import { createTable, decimal, required } from 'oopg';
 *
 * await createTable(client, 'products', {
 *   price: required(decimal(10, 2)),
 * });
 * ```
 */
export const decimal = (precision?: number, scale?: number) =>
  ({ type: 'decimal', precision, scale }) as const;

/**
 * Defines a numeric column with optional precision and scale.
 *
 * @param precision - total number of significant digits
 * @param scale - number of digits after the decimal point
 * @returns a numeric column type descriptor
 *
 * @example
 * ```ts
 * import { createTable, numeric, required } from 'oopg';
 *
 * await createTable(client, 'measurements', {
 *   value: required(numeric(12, 4)),
 * });
 * ```
 */
export const numeric = (precision?: number, scale?: number) =>
  ({ type: 'numeric', precision, scale }) as const;

/**
 * Defines a float column with optional precision.
 *
 * @param precision - number of significant bits
 * @returns a float column type descriptor
 *
 * @example
 * ```ts
 * import { createTable, float } from 'oopg';
 *
 * await createTable(client, 'sensors', {
 *   reading: float(8),
 * });
 * ```
 */
export const float = (precision?: number) =>
  ({ type: 'float', precision }) as const;

/**
 * Defines a boolean column with an optional static default value.
 *
 * @param defaultValue - default value inserted when the column is omitted; omit to have no default
 * @returns a boolean column type descriptor
 *
 * @example
 * ```ts
 * import { createTable, boolean } from 'oopg';
 *
 * await createTable(client, 'accounts', {
 *   active: boolean(true),
 * });
 * ```
 */
export const boolean = (defaultValue?: boolean) =>
  ({
    type: 'boolean',
    default: defaultValue === undefined ? undefined : `${defaultValue}`,
  }) as const;

/**
 * Defines a date column with an optional `CURRENT_DATE` default.
 *
 * @param auto - when `true` (the default), the column defaults to `CURRENT_DATE`
 * @returns a date column type descriptor
 *
 * @example
 * ```ts
 * import { createTable, date } from 'oopg';
 *
 * await createTable(client, 'events', {
 *   createdOn: date(),      // defaults to CURRENT_DATE
 *   scheduledOn: date(false), // no default
 * });
 * ```
 */
export const date = (auto = true) =>
  ({
    type: 'date',
    default: auto ? ({ '=': 'CURRENT_DATE' } as const) : undefined,
  }) as const;

/**
 * Defines a timestamptz column with an optional `CURRENT_TIMESTAMP` default.
 *
 * @param auto - when `true` (the default), the column defaults to `NOW()`
 * @returns a timestamptz column type descriptor
 *
 * @example
 * ```ts
 * import { createTable, datetime } from 'oopg';
 *
 * await createTable(client, 'posts', {
 *   createdAt: datetime(),       // defaults to CURRENT_TIMESTAMP
 *   publishedAt: datetime(false), // no default
 * });
 * ```
 */
export const datetime = (auto = true) =>
  ({
    type: 'timestamptz',
    default: auto ? ({ '=': 'CURRENT_TIMESTAMP' } as const) : undefined,
  }) as const;

/**
 * Marks a column definition as NOT NULL — the column must be provided on insert.
 *
 * @param def - the base column definition to make required
 * @returns the column definition with `required: true`
 *
 * @example
 * ```ts
 * import { createTable, varchar, required } from 'oopg';
 *
 * await createTable(client, 'users', {
 *   email: required(varchar(255)),
 * });
 * ```
 */
export const required = <T>(def: ColumnDefinition<T>) => {
  if (typeof def === 'object') return { ...def, required: true };
  return { type: def, required: true };
};

// type PGTypesMap = typeof PGTypesMap;
/**
 * Maps a `PGType` column type to its JavaScript runtime type.
 *
 * @example
 * ```ts
 * import type { JSType } from 'oopg';
 *
 * // JSType<'text'> resolves to string
 * // JSType<'timestamptz'> resolves to Date
 * // JSType<'decimal'> resolves to number
 * type Price = JSType<'decimal'>; // number
 * ```
 */
export type JSType<K extends PGType> = K extends PGTextType
  ? string
  : K extends PGDateType
    ? Date
    : K extends PGObjectType
      ? object
      : K extends PGBooleanType
        ? boolean
        : K extends PGNumericType
          ? number
          : never;

type Precise<T extends string, REQ extends boolean = false> = REQ extends true
  ? { type: T; precision: number }
  : T | { type: T; precision?: number };

type Scale<T extends string, REQ extends boolean = false> = REQ extends true
  ? { type: T; precision: number; scale?: number }
  :
      | T
      | { type: T; precision?: number; scale: never }
      | { type: T; precision: number; scale?: number };

/** Default PostgreSQL type used for auto-generated id columns (`'text'`). */
export const PGIDType = 'text' as const satisfies PGType;
/** Default PostgreSQL type used for auto-generated id columns (`'text'`). */
export type PGIDType = typeof PGIDType;

/** JavaScript type corresponding to `PGIDType` — resolves to `string`. */
export type IDType = JSType<PGIDType>;

/** Generic record type representing a database row. All column values are `unknown`. */
export type Row = Record<string, unknown>;

/**
 * A database row that includes the auto-generated `id` column.
 *
 * @example
 * ```ts
 * import type { RowWithId } from 'oopg';
 *
 * type UserRow = RowWithId<{ name: string; email: string }>;
 * // { id: string; name: string; email: string }
 * ```
 */
export type RowWithId<T extends Row = Row> = {
  id: JSType<typeof PGIDType>;
} & T;

/** SQL comparison operator used in query filter objects. */
export type ComparisonOperator = '=' | '<' | '>' | '<=' | '>=' | 'is' | 'in';

/** Partial map of comparison operators to values for use in query filters. */
export type Comparison<T> = Partial<{ [K in ComparisonOperator]: T }>;

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type AllKeys<T> = T extends any ? keyof T : never;

/**
 * Defines an index on one or more columns with optional uniqueness and WHERE clause.
 *
 * @example
 * ```ts
 * import { createTable, createIndexes, varchar, required } from 'oopg';
 *
 * await createTable(client, 'users', { email: required(varchar(255)) });
 *
 * await createIndexes(client, 'users', [
 *   { on: 'email', unique: true },
 *   { on: ['lastName', 'firstName'] },
 * ]);
 * ```
 */
export type IndexDefinition<R extends Row = Row> =
  | AllKeys<R>
  | AllKeys<R>[]
  | {
      on: AllKeys<R> | AllKeys<R>[];
      name?: string;
      unique?: boolean;
      // TODO: Plan for more control on partial indexes
      where?: string;
      options?: string;
    }
  | {
      on?: AllKeys<R> | AllKeys<R>[];
      name?: string;
      unique?: boolean;
      // TODO: Plan for more control on partial indexes
      where?: string;
      options: string;
    };

/**
 * Defines a foreign key constraint referencing another table.
 *
 * @example
 * ```ts
 * import type { ForeignKeyDefinition } from 'oopg';
 *
 * const fk: ForeignKeyDefinition = {
 *   keys: 'authorId',
 *   references: 'authors',
 *   columns: ['id'],
 * };
 * ```
 */
export type ForeignKeyDefinition<R extends Row = Row> = {
  keys: AllKeys<R>;
  references: EntityDescription;
  columns: string[];
};

/**
 * SQL formula strings allowed as column default values.
 *
 * @example
 * ```ts
 * import type { DEFAULT_FORMULAES } from 'oopg';
 *
 * const formula: DEFAULT_FORMULAES = 'CURRENT_TIMESTAMP';
 * ```
 */
export type DEFAULT_FORMULAES =
  | 'CURRENT_TIMESTAMP'
  | 'true'
  | 'false'
  | `nextvalue("${string}")`
  | (string & {});

/** A simple column definition — either a plain `PGType` string or a single-element array (for array columns). */
export type SimpleColumnDefinition<T = unknown> = PGType<T> | [PGType<T>];

/** A complex column definition object with optional `required`, `default`, `unique`, and type or foreign key. */
export type ComplexColumnDefinition<T = unknown> = {
  required?: boolean;
  default?: string | number | { '=': DEFAULT_FORMULAES };
  unique?: boolean;
} & ({ type: SimpleColumnDefinition<T> } | ColumnForeignKeyDefinition);

/** A column definition that declares a foreign key reference to another table. */
export type ColumnForeignKeyDefinition = {
  references: string | (EntityDescription & { column?: string });
} & AddForeignKeyOptions;

/**
 * Type guard that checks whether a column definition is a foreign key definition.
 *
 * @param def - the column definition to test
 * @returns `true` if `def` is a `ColumnForeignKeyDefinition`
 *
 * @example
 * ```ts
 * import { isForeignKey } from 'oopg';
 *
 * const col = { references: 'authors' };
 * if (isForeignKey(col)) {
 *   console.log('foreign key to:', col.references);
 * }
 * ```
 */
export function isForeignKey(
  def: ColumnDefinition,
): def is ColumnForeignKeyDefinition {
  return typeof def === 'object' && 'references' in def;
}

/** Union of all column definition forms — simple type string, array, or complex object. */
export type ColumnDefinition<T = unknown> =
  | SimpleColumnDefinition<T>
  | ComplexColumnDefinition<T>;

export type ColumnToType<DEF extends ColumnDefinition> = DEF extends PGType
  ? JSType<DEF>
  : DEF extends Array<infer TYP>
    ? TYP extends PGType
      ? JSType<TYP>[]
      : never
    : DEF extends { type: infer TYPS }
      ? TYPS extends PGType | [PGType]
        ? ColumnToType<TYPS>
        : never
      : DEF extends { references: unknown }
        ? RowWithId['userId']
        : never;

// export type ColumnsDefinition = { [K: string]: ColumnDefinition };

/**
 * Infers the TypeScript row shape expected when inserting into a table.
 * Required columns (marked with `required()`) are mandatory; all others are optional.
 *
 * @example
 * ```ts
 * import type { InputType } from 'oopg';
 * import { varchar, required, datetime } from 'oopg';
 *
 * const cols = {
 *   name:      required(varchar(100)),
 *   createdAt: datetime(),
 * } as const;
 *
 * type InsertUser = InputType<typeof cols>;
 * // { name: string; createdAt?: Date }
 * ```
 */
export type InputType<DEFS extends { [K: string]: ColumnDefinition }> =
  // Required columns
  {
    [K in keyof DEFS as DEFS[K] extends ColumnDefinition
      ? DEFS[K] extends { required: true }
        ? K
        : never
      : never]: ColumnToType<DEFS[K]>;
  } & {
    // Optional columns or with default
    [K in keyof DEFS as DEFS[K] extends ColumnDefinition
      ? DEFS[K] extends { required: true }
        ? never
        : K
      : never]?: ColumnToType<DEFS[K]>;
  };

/**
 * Infers the TypeScript row shape returned by SELECT queries on a table.
 * Columns with a default or `required` constraint are non-optional in output.
 *
 * @example
 * ```ts
 * import type { OutputType } from 'oopg';
 * import { varchar, required, datetime } from 'oopg';
 *
 * const cols = {
 *   name:      required(varchar(100)),
 *   createdAt: datetime(),
 * } as const;
 *
 * type UserRow = OutputType<typeof cols>;
 * // { name: string; createdAt: Date }
 * ```
 */
export type OutputType<DEFS extends { [K: string]: ColumnDefinition }> =
  // Required columns or with auto
  {
    [K in keyof DEFS as DEFS[K] extends ColumnDefinition
      ? DEFS[K] extends { required: true } | { default: unknown }
        ? DEFS[K] extends
            | { default?: undefined }
            | { default: null }
            | { required?: undefined }
          ? never
          : K
        : never
      : never]: ColumnToType<DEFS[K]>;
  } & {
    // Optional columns
    [K in keyof DEFS as DEFS[K] extends ColumnDefinition
      ? DEFS[K] extends { required: true } | { default: unknown }
        ? DEFS[K] extends
            | { default?: undefined }
            | { default: null }
            | { required?: undefined }
          ? K
          : never
        : K
      : never]?: ColumnToType<DEFS[K]>;
  };

/**
 * Extracts the keys of columns that have automatic defaults (e.g. `date()`, `datetime()`).
 * These columns can be omitted from insert payloads.
 *
 * @example
 * ```ts
 * import type { AutoColumns } from 'oopg';
 * import { datetime } from 'oopg';
 *
 * const cols = { name: 'text', createdAt: datetime() } as const;
 * type Auto = AutoColumns<typeof cols>; // 'createdAt'
 * ```
 */
export type AutoColumns<DEFS extends { [K: string]: ColumnDefinition }> =
  keyof // Required columns or with auto
  {
    [K in keyof DEFS as DEFS[K] extends ColumnDefinition
      ? DEFS[K] extends { default: unknown }
        ? DEFS[K] extends { default?: undefined } | { default: null }
          ? never
          : K
        : never
      : never]: unknown;
  };

/** Common options accepted by database operation functions. */
export type OperationOptions = { debug?: boolean };

/** TEST ZONE **

type T = { default: 0 } extends { default: undefined } ? true : false;

const def = ['text'] as const;
type COL = ColumnToType<'text'>;
type COLS = ColumnToType<['text']>;
type DEF = ColumnToType<[{ type: 'decimal'; precision: 10; scale: 2 }]>;
type DEFS = ColumnToType<{ type: [{ type: 'varchar'; precision: 32 }] }>;
type REF = ColumnToType<{ references: 'table' }>;

type CT = {
	// Input yes
	test: ['decimal'];
	far: { type: 'text'; required: undefined };
	ffar: { type: 'text'; required: true };
	dte: { type: 'timestamptz'; default: 'CURRENT_TIMESTAMP' };
	boo: { type: [{ type: 'decimal'; precision: 10 }]; default: '0' };
	odte: { type: 'timestamptz'; default: undefined };
	oodte: { type: 'timestamptz' };
};

type IT = InputType<CT>;
type OT = OutputType<CT>;
type AK = AutoColumns<CT>;

/**  **/

/**
 * Table or view reference — either a plain string name or an object with `name` and optional `schema`.
 *
 * @example
 * ```ts
 * import type { EntityDescription } from 'oopg';
 *
 * const simple: EntityDescription = 'users';
 * const qualified: EntityDescription = { name: 'users', schema: 'app' };
 * ```
 */
export type EntityDescription = string | { name: string; schema?: string };
