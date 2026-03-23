import { L } from '@lalex/console';
import { type ClientBase, types } from 'pg';
import Cursor from 'pg-cursor';
import QueryStream from 'pg-query-stream';
import type { OperationOptions, Row } from './types';
import { clientQuery, getValuesAndOptions, type QueryOptions } from './utils';

const LL = L.scope('oopg/query');
export type SelectOptions = QueryOptions & { stream?: boolean };

export function select<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  valuesOrOptions?: unknown[] | SelectOptions,
  optionsWhenValues?: SelectOptions,
) {
  const { values, options } = getValuesAndOptions(
    valuesOrOptions,
    optionsWhenValues,
  );
  return clientQuery<R>(client, sql, values, { types, ...options }).then(
    ({ rows }) => rows,
  );
}

export type ExecuteOptions = QueryOptions;
export async function execute<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  valuesOrOptions?: unknown[] | ExecuteOptions,
  optionsWhenValues?: ExecuteOptions,
) {
  const { values, options } = getValuesAndOptions(
    valuesOrOptions,
    optionsWhenValues,
  );
  const queryResult = await clientQuery<R>(client, sql, values, {
    ...options,
    types: { ...types, ...options?.types },
  });

  const { command, rowCount: count, rows, fields } = queryResult;
  if (options?.debug && ['insert', 'update', 'delete'].includes(command))
    L.debug('>>', count, 'rows performed');

  const result = { command, count, rows, fields };
  return result;
}

export type CursorOptions = OperationOptions &
  Omit<Cursor.CursorQueryConfig, 'rowMode'>;
export function cursor<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  valuesOrOptions?: unknown[] | CursorOptions,
  optionsWhenValues?: CursorOptions,
) {
  const { values, options } = getValuesAndOptions(
    valuesOrOptions,
    optionsWhenValues,
  );
  const { debug, ...cursOptions } = options ?? {};
  if (options?.debug || process.env.OOPG_SHOW_SQL === 'true')
    L.debug('[CURSOR]', sql, values, options);
  const curs = new Cursor<R>(sql, values, {
    ...cursOptions,
    types: { ...types, ...options?.types },
  });

  return clientQuery(client, curs);
}

export type StreamOptions = Omit<CursorOptions, 'name'> & {
  batchSize?: number;
  highWaterMark?: number;
};
export function stream(
  client: ClientBase,
  sql: string,
  valuesOrOptions?: unknown[] | StreamOptions,
  optionsWhenValues?: StreamOptions,
) {
  const { values, options } = getValuesAndOptions(
    valuesOrOptions,
    optionsWhenValues,
  );
  if (options?.debug || process.env.OOPG_SHOW_SQL === 'true') {
    LL.debug('[STREAM]', sql, values);
  }
  return clientQuery(
    client,
    new QueryStream(sql, values, {
      ...options,
      types: { ...types, ...options?.types },
    }),
  );
}

export type ChunksOptions = CursorOptions & { size?: number; wait?: boolean };
export type ChunkCallback<R extends Row = Row> = (
  rows: R[],
  position: number,
  close: () => Promise<void>,
) => Promise<void> | void;

export function chunk<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  callback: ChunkCallback<R>,
  options?: ChunksOptions,
): Promise<void>;
export function chunk<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  values: unknown[],
  callback: ChunkCallback<R>,
  options?: ChunksOptions,
): Promise<void>;
export async function chunk<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  valuesOrCallback: unknown[] | ChunkCallback<R>,
  callbackOrOptions?: ChunkCallback<R> | ChunksOptions,
  optionsWhenValues?: ChunksOptions,
) {
  let callback: ChunkCallback<R> | undefined;
  let values: unknown[] = [];
  let options: ChunksOptions | undefined;
  switch (true) {
    case typeof valuesOrCallback === 'function':
      callback = valuesOrCallback as ChunkCallback<R>;
      options = callbackOrOptions as ChunksOptions;
      break;
    case Array.isArray(valuesOrCallback) &&
      typeof callbackOrOptions === 'function':
      values = valuesOrCallback;
      callback = callbackOrOptions as ChunkCallback<R>;
      options = optionsWhenValues;
      break;
  }
  if (!callback) throw new Error('No callback');
  const { size = 100, wait = true, ...cursorOptions } = options ?? {};

  const curs = cursor<R>(client, sql, values, cursorOptions);
  let position = 0;
  try {
    let rows: R[];
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic cursor read pattern
    while ((rows = await curs.read(size)).length) {
      const nextPosition = position + rows.length;
      const close = async () => {
        await curs.close();
      };
      if (wait) {
        await callback(rows, position, close);
      } else {
        callback(rows, position, close);
      }
      position = nextPosition;
    }
  } finally {
    await curs.close();
  }
}

export type StepOptions = Omit<ChunksOptions, 'size'>;
export type StepCallback<R extends Row = Row> = (
  row: R,
  position: number,
  close: () => Promise<void>,
) => Promise<void> | void;

export function step<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  callback: StepCallback<R>,
  options?: StepOptions,
): Promise<void>;
export function step<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  values: unknown[],
  callback: StepCallback<R>,
  options?: StepOptions,
): Promise<void>;
export function step<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  valuesOrCallback: unknown[] | StepCallback<R>,
  callbackOrOptions?: StepCallback<R> | StepOptions,
  optionsWhenValues?: StepOptions,
) {
  let callback: StepCallback<R> | undefined;
  let values: unknown[] = [];
  let options: ChunksOptions | undefined;
  switch (true) {
    case typeof valuesOrCallback === 'function':
      callback = valuesOrCallback as StepCallback<R>;
      options = callbackOrOptions as ChunksOptions;
      break;
    case Array.isArray(valuesOrCallback) &&
      typeof callbackOrOptions === 'function':
      values = valuesOrCallback;
      callback = callbackOrOptions as StepCallback<R>;
      options = optionsWhenValues;
      break;
  }
  return chunk<R>(
    client,
    sql,
    values,
    (rows, position, close) => callback?.(rows[0], position, close),
    {
      ...options,
      size: 1,
    },
  );
}

export type FirstOptions = CursorOptions;
export async function first<R extends Row = Row>(
  client: ClientBase,
  sql: string,
  valuesOrOptions?: unknown[] | FirstOptions,
  optionsWhenValues?: FirstOptions,
) {
  const { values, options } = getValuesAndOptions(
    valuesOrOptions,
    optionsWhenValues,
  );
  let found: R | undefined;
  await step<R>(
    client,
    sql,
    values,
    async (row, _, close) => {
      found = row;
      await close();
    },
    { ...options, wait: true },
  );
  return found;
}
