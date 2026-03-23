import type { AddForeignKeyOptions } from './tables';
import { types as _pgTypes } from 'pg';
/** Union of all built-in PostgreSQL type names (e.g. 'INT8', 'NUMERIC'). Use with the Database constructor `types` option to override type parsers per pool. */
export type PGTypeName = keyof typeof _pgTypes.builtins;

export type PGType<T = unknown> = T extends number | bigint
	? PGNumericType
	: T extends string
		? PGTextType
		: T extends boolean
			? PGBooleanType
			: T extends Date
				? PGDateType
				: PGDateType | PGTextType | PGNumericType | PGObjectType | PGBooleanType;

type PGDateType = 'timestamptz' | 'date';
type PGTextType = 'text' | Precise<'varchar'>;
type PGNumericType = 'smallint' | 'int' | 'bigint' | Scale<'numeric'> | Scale<'decimal'> | Precise<'float'>;
type PGObjectType = 'json' | 'jsonb';
type PGBooleanType = 'boolean';

export const varchar = (precision?: number) => ({ type: 'varchar', precision }) as const;
export const decimal = (precision?: number, scale?: number) => ({ type: 'decimal', precision, scale }) as const;
export const numeric = (precision?: number, scale?: number) => ({ type: 'numeric', precision, scale }) as const;
export const float = (precision?: number) => ({ type: 'float', precision }) as const;

export const boolean = (defaultValue?: boolean) =>
	({
		type: 'boolean',
		default: defaultValue === undefined ? undefined : `${defaultValue}`,
	}) as const;
export const date = (auto = true) =>
	({
		type: 'date',
		default: auto ? ({ '=': 'CURRENT_DATE' } as const) : undefined,
	}) as const;
export const datetime = (auto = true) =>
	({
		type: 'timestamptz',
		default: auto ? ({ '=': 'CURRENT_TIMESTAMP' } as const) : undefined,
	}) as const;

export const required = <T>(def: ColumnDefinition<T>) => {
	if (typeof def === 'object') return { ...def, required: true };
	return { type: def, required: true };
};

// type PGTypesMap = typeof PGTypesMap;
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
	: T | { type: T; precision?: number; scale: never } | { type: T; precision: number; scale?: number };

export const PGIDType = 'text' as const satisfies PGType;
export type PGIDType = typeof PGIDType;

export type IDType = JSType<PGIDType>;

export type Row = Record<string, unknown>;
export type RowWithId<T extends Row = Row> = {
	id: JSType<typeof PGIDType>;
} & T;

export type ComparisonOperator = '=' | '<' | '>' | '<=' | '>=' | 'is' | 'in';
export type Comparison<T> = Partial<{ [K in ComparisonOperator]: T }>;

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type AllKeys<T> = T extends any ? keyof T : never;

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
	  } | {
			on?: AllKeys<R> | AllKeys<R>[];
			name?: string;
			unique?: boolean;
			// TODO: Plan for more control on partial indexes
			where?: string;
			options: string;
	  };

export type ForeignKeyDefinition<R extends Row = Row> = {
	keys: AllKeys<R>;
	references: EntityDescription;
	columns: string[];
};

export type DEFAULT_FORMULAES = 'CURRENT_TIMESTAMP' | 'true' | 'false' | `nextvalue("${string}")` | (string & {});

export type SimpleColumnDefinition<T = unknown> = PGType<T> | [PGType<T>];
export type ComplexColumnDefinition<T = unknown> = {
	required?: boolean;
	default?: string | number | { '=': DEFAULT_FORMULAES };
	unique?: boolean;
} & ({ type: SimpleColumnDefinition<T> } | ColumnForeignKeyDefinition);

export type ColumnForeignKeyDefinition = {
	references: string | (EntityDescription & { column?: string });
} & AddForeignKeyOptions;

export function isForeignKey(def: ColumnDefinition): def is ColumnForeignKeyDefinition {
	return typeof def === 'object' && 'references' in def;
}
export type ColumnDefinition<T = unknown> = SimpleColumnDefinition<T> | ComplexColumnDefinition<T>;

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

export type OutputType<DEFS extends { [K: string]: ColumnDefinition }> =
	// Required columns or with auto
	{
		[K in keyof DEFS as DEFS[K] extends ColumnDefinition
			? DEFS[K] extends { required: true } | { default: unknown }
				? DEFS[K] extends { default?: undefined } | { default: null } | { required?: undefined }
					? never
					: K
				: never
			: never]: ColumnToType<DEFS[K]>;
	} & {
		// Optional columns
		[K in keyof DEFS as DEFS[K] extends ColumnDefinition
			? DEFS[K] extends { required: true } | { default: unknown }
				? DEFS[K] extends { default?: undefined } | { default: null } | { required?: undefined }
					? K
					: never
				: K
			: never]?: ColumnToType<DEFS[K]>;
	};

export type AutoColumns<DEFS extends { [K: string]: ColumnDefinition }> = keyof // Required columns or with auto
{
	[K in keyof DEFS as DEFS[K] extends ColumnDefinition
		? DEFS[K] extends { default: unknown }
			? DEFS[K] extends { default?: undefined } | { default: null }
				? never
				: K
			: never
		: never]: unknown;
};

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

export type EntityDescription = string | { name: string; schema?: string };
