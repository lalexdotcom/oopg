import { L } from '@lalex/console';
import {
  type ClientBase,
  type ClientConfig,
  escapeLiteral,
  type QueryConfig,
  type QueryResult,
  type Submittable,
} from 'pg';
import {
  type ColumnDefinition,
  type EntityDescription,
  type OperationOptions,
  PGIDType,
  type PGType,
  type Row,
} from './types';

export function valueToSQL(val: unknown, escapeString = true): string {
  // null is NULL
  if (val === null) return 'NULL';
  // Array is mapped
  if (Array.isArray(val)) return val.map((v) => valueToSQL(v)).join(',');
  // Date is ISO
  if (val instanceof Date) return `'${val.toISOString()}'`;
  // String is quoted
  if (typeof val === 'string')
    return escapeString ? `'${val.replace("'", "''")}'` : `"${val}"`;
  // Object is JSON (dates and arrays returned already)
  if (typeof val === 'object') return JSON.stringify(val);
  // Else, stringify (boolean/numeric)
  return `${val}`;
}

// export function formatEntity(options?: { prefix?: string; quote?: boolean }) {
// 	return (name: string) => {
// 		const path = name.split('.');
// 		if (options?.prefix) path.unshift(options.prefix);
// 		return path.map(elt => (options?.quote ?? true ? `"${elt}"` : elt)).join('.');
// 	};
// }

export const columnDefinitionToSQL = (def: ColumnDefinition) => {
  if (Array.isArray(def) || typeof def === 'string')
    return columnTypeToSQL(def);
  let columnSQL: string;
  const columnConstraints: string[] = [];
  if ('references' in def) {
    columnSQL = columnTypeToSQL(PGIDType);
  } else if ('precision' in def) {
    columnSQL = columnTypeToSQL(def);
  } else {
    columnSQL = columnTypeToSQL(def.type);
  }
  if ('required' in def && !!def.required) columnConstraints.push('NOT NULL');
  if ('default' in def) {
    const { default: value } = def;
    let valueSQL: string | undefined;
    if (
      typeof value === 'object' &&
      '=' in value &&
      // Only property is '='
      Object.keys(value).join('/•.?') === '='
    ) {
      // Default value has a single '=' field
      valueSQL = value['='];
    } else if (value !== undefined) {
      // Default value is a raw value
      valueSQL = valueToSQL(def.default);
    }
    if (valueSQL) columnConstraints.push(`DEFAULT ${valueSQL}`);
  }

  if (columnConstraints.length) columnSQL += ` ${columnConstraints.join(' ')}`;
  return columnSQL;
  // }
};

export function formatEntity(
  entity: string | { name: string; schema?: string; column?: string },
  options?: { quote?: boolean },
) {
  const quote = (str: string) => ((options?.quote ?? true) ? `"${str}"` : str);
  if (typeof entity === 'string') return quote(entity);
  let formated = '';
  for (const val of [entity.schema, entity.name, entity.column]) {
    if (val) {
      if (formated) formated += '.';
      formated += quote(val);
    }
  }
  return formated;
}

export function getValuesAndOptions<V, O>(
  valuesOrOptions?: V[] | O,
  optionsWhenValues?: O,
) {
  const values = Array.isArray(valuesOrOptions) ? valuesOrOptions : [];
  const options = Array.isArray(valuesOrOptions)
    ? optionsWhenValues
    : valuesOrOptions;
  return { values, options };
}

export type QueryOptions = OperationOptions &
  Omit<QueryConfig, 'text' | 'values'>;

export function clientQuery<T extends Submittable>(
  client: ClientBase,
  sub: T,
  options?: OperationOptions,
): T;
export function clientQuery<T extends Row>(
  client: ClientBase,
  sql: string | Submittable,
  valuesOrOptions?: unknown[] | QueryOptions,
  optionsWhenValues?: QueryOptions,
): Promise<QueryResult<T>>;
export function clientQuery(
  client: ClientBase,
  sqlOrSubmittable: string | Submittable,
  valuesOrOptions?: unknown[] | QueryOptions,
  optionsWhenValues?: QueryOptions,
) {
  const { values, options } = getValuesAndOptions(
    valuesOrOptions,
    optionsWhenValues,
  );

  if (
    (options?.debug || process.env.OOPG_SHOW_SQL === 'true') &&
    typeof sqlOrSubmittable === 'string'
  ) {
    L.debug('[SQL]', sqlOrSubmittable, values);
  }
  const { debug, ...restOptions } = options ?? {};
  try {
    if (typeof sqlOrSubmittable === 'string') {
      return client?.query({
        ...restOptions,
        text: sqlOrSubmittable,
        values: values,
      });
    }
    const sub = client.query(sqlOrSubmittable);
    return sub;
  } catch (e) {
    if (typeof sqlOrSubmittable === 'string') L.error(sqlOrSubmittable);
    throw e;
  }
}
type ConnectionSSLMode =
  | 'disable'
  | 'prefer'
  | 'require'
  | 'verify-ca'
  | 'verify-full'
  | 'no-verify';

declare module 'pg' {
  interface ClientConfig {
    client_encoding?: string;
    sslcert?: string;
    sslkey?: string;
    sslrootcert?: string;
    sslmode?: ConnectionSSLMode;
  }

  interface PoolConfig {
    connectionTimeoutMillis?: number;
  }
}

export function parseConnectionString(uri: string): ClientConfig {
  let dbURI = uri;
  //unix socket
  if (dbURI.charAt(0) === '/') {
    const config = dbURI.split(' ');
    return { host: config[0], database: config[1] };
  }

  // Check for empty host in URL

  const config: ClientConfig = {};
  let result: URL;
  let dummyHost = false;
  if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(dbURI)) {
    // Ensure spaces are encoded as %20
    dbURI = encodeURI(dbURI).replace(/%25(\d\d)/g, '%$1');
  }

  try {
    result = new URL(dbURI, 'postgres://base');
  } catch (e) {
    // The URL is invalid so try again with a dummy host
    result = new URL(dbURI.replace('@/', '@___DUMMY___/'), 'postgres://base');
    dummyHost = true;
  }

  // We'd like to use Object.fromEntries() here but Node.js 10 does not support it
  for (const [key, value] of result.searchParams.entries()) {
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    (config as any)[key] = value;
  }

  config.user = config.user || decodeURIComponent(result.username);
  config.password = config.password || decodeURIComponent(result.password);

  if (result.protocol === 'socket:') {
    config.host = decodeURI(result.pathname);
    config.database = result.searchParams.get('db') ?? undefined;
    config.client_encoding = result.searchParams.get('encoding') ?? undefined;
    return config;
  }
  const hostname = dummyHost ? '' : result.hostname;
  if (!config.host) {
    // Only set the host if there is no equivalent query param.
    config.host = decodeURIComponent(hostname);
  } else if (hostname && /^%2f/i.test(hostname)) {
    // Only prepend the hostname to the pathname if it is not a URL encoded Unix socket host.
    result.pathname = hostname + result.pathname;
  }
  if (!config.port) {
    // Only set the port if there is no equivalent query param.
    config.port = result.port ? Number.parseInt(result.port, 10) : undefined;
  }

  const pathname = result.pathname.slice(1) || null;
  config.database = pathname ? decodeURI(pathname) : undefined;

  if (config.ssl === true) {
    config.ssl = true;
  }

  if (config.sslcert || config.sslkey || config.sslrootcert || config.sslmode) {
    config.ssl = {};
    if (config.sslcert || config.sslkey || config.sslrootcert) {
      // Only try to load fs if we expect to read from the disk
      const fs = require('node:fs');

      if (config.sslcert) {
        config.ssl.cert = fs.readFileSync(config.sslcert).toString();
      }

      if (config.sslkey) {
        config.ssl.key = fs.readFileSync(config.sslkey).toString();
      }

      if (config.sslrootcert) {
        config.ssl.ca = fs.readFileSync(config.sslrootcert).toString();
      }

      switch (config.sslmode) {
        case 'disable': {
          config.ssl = false;
          break;
        }
        case 'prefer':
        case 'require':
        case 'verify-ca':
        case 'verify-full': {
          break;
        }
        case 'no-verify': {
          config.ssl.rejectUnauthorized = false;
          break;
        }
      }
    }
  }

  return config;
}

/**
 * Converts an `EntityDescription` (string name or `{ name, schema }` object) to a plain entity object.
 *
 * @param table - A table name string or an object with `name` and optional `schema`.
 * @returns An object with `name` and optional `schema` properties.
 *
 * @example
 * import { utils } from '@lalex/oopg';
 *
 * utils.descriptionToEntity('users');
 * // → { name: 'users' }
 *
 * utils.descriptionToEntity({ name: 'users', schema: 'public' });
 * // → { name: 'users', schema: 'public' }
 */
export const descriptionToEntity = (table: EntityDescription) => {
  return typeof table === 'object'
    ? { name: table.name, schema: table.schema }
    : { name: table };
};

/**
 * Converts a `PGType` column type definition to its SQL string representation.
 *
 * Supports plain type strings (`'varchar'`), precision types (`{ type: 'numeric', precision: 10, scale: 2 }`),
 * and array types (`['text']`). Throws a descriptive error if `scale` is used with a non-numeric type.
 *
 * @param type - A PostgreSQL type string, a precision/scale object, or a single-element tuple for arrays.
 * @returns The SQL type string, e.g. `'varchar'`, `'numeric(10,2)'`, `'text[]'`.
 * @throws {Error} If `scale` is specified for a type other than `numeric` or `decimal`.
 *
 * @example
 * import { utils } from '@lalex/oopg';
 *
 * utils.columnTypeToSQL('varchar');      // 'varchar'
 * utils.columnTypeToSQL(['text']);       // 'text[]'
 * utils.columnTypeToSQL({ type: 'numeric', precision: 10, scale: 2 }); // 'numeric(10,2)'
 */
export const columnTypeToSQL = (type: PGType | [PGType]): string => {
  if (Array.isArray(type)) {
    if (type.length === 1) return `${columnTypeToSQL(type[0])}[]`;
    throw new Error('Bad column definition format');
  }
  if (typeof type === 'string') return `${type}`;
  const typeStr = type.type;
  if ('scale' in type && type.scale !== undefined && !['numeric', 'decimal'].includes(typeStr)) {
    throw new Error('columnTypeToSQL: scale is only valid for numeric and decimal types');
  }
  const typeParams: number[] = [];
  if (
    typeof type.precision === 'number' &&
    !Number.isNaN(type.precision) &&
    type.precision
  ) {
    typeParams.push(type.precision);
    if (
      'scale' in type &&
      typeof type.scale === 'number' &&
      !Number.isNaN(type.scale)
    ) {
      typeParams.push(type.scale);
    }
  }
  const typeSQL =
    typeStr + (typeParams.length ? `(${typeParams.join(',')})` : '');
  return typeSQL;
};

/**
 * Escapes a string literal for safe inclusion in a PostgreSQL SQL query.
 * Wraps the value in single quotes and escapes any single quotes within it.
 *
 * This is a re-export of `pg.escapeLiteral`. Use when building dynamic SQL
 * outside of template literals where parameterised queries are not available.
 *
 * @param str - The string value to escape.
 * @returns The escaped SQL literal string, including surrounding single quotes.
 *
 * @example
 * import { utils } from '@lalex/oopg';
 *
 * utils.escape("O'Brien"); // "'O''Brien'"
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
export const escape = escapeLiteral;
