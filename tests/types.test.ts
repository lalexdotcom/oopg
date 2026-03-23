import { describe, expect, test } from '@rstest/core';
import { boolean, date, datetime } from '../src/types';
import type {
  AutoColumns,
  ColumnToType,
  InputType,
  JSType,
  OutputType,
} from '../src/types';

// Compile-time equality helper: resolves to `true` only when A and B are mutually assignable.
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe('JSType mappings', () => {
  test('text maps to string', () => {
    const check: IsExact<JSType<'text'>, string> = true;
    expect(check).toBe(true);
  });

  test('int maps to number', () => {
    const check: IsExact<JSType<'int'>, number> = true;
    expect(check).toBe(true);
  });

  test('bigint maps to number', () => {
    const check: IsExact<JSType<'bigint'>, number> = true;
    expect(check).toBe(true);
  });

  test('boolean maps to boolean', () => {
    const check: IsExact<JSType<'boolean'>, boolean> = true;
    expect(check).toBe(true);
  });

  test('timestamptz maps to Date', () => {
    const check: IsExact<JSType<'timestamptz'>, Date> = true;
    expect(check).toBe(true);
  });

  test('date maps to Date', () => {
    const check: IsExact<JSType<'date'>, Date> = true;
    expect(check).toBe(true);
  });

  test('json maps to object', () => {
    const check: IsExact<JSType<'json'>, object> = true;
    expect(check).toBe(true);
  });

  test('jsonb maps to object', () => {
    const check: IsExact<JSType<'jsonb'>, object> = true;
    expect(check).toBe(true);
  });

  test('varchar descriptor maps to string', () => {
    const check: IsExact<JSType<{ type: 'varchar'; precision: 100 }>, string> = true;
    expect(check).toBe(true);
  });

  test('decimal descriptor maps to number', () => {
    const check: IsExact<JSType<{ type: 'decimal'; precision: 10; scale: 2 }>, number> = true;
    expect(check).toBe(true);
  });
});

describe('ColumnToType mappings', () => {
  test('plain string type resolves correctly', () => {
    const check: IsExact<ColumnToType<'text'>, string> = true;
    expect(check).toBe(true);
  });

  test('array column resolves to element type array', () => {
    const check: IsExact<ColumnToType<['text']>, string[]> = true;
    expect(check).toBe(true);
  });

  test('complex type with required:true resolves to base type', () => {
    const check: IsExact<ColumnToType<{ type: 'int'; required: true }>, number> = true;
    expect(check).toBe(true);
  });

  test('complex type with array type and default resolves to element array', () => {
    const check: IsExact<ColumnToType<{ type: ['decimal']; default: '0' }>, number[]> = true;
    expect(check).toBe(true);
  });

  test('foreign key reference resolves to unknown (RowWithId string index)', () => {
    const check: IsExact<ColumnToType<{ references: 'table' }>, unknown> = true;
    expect(check).toBe(true);
  });
});

// Column definitions used by InputType / OutputType / AutoColumns tests
// Note: required() helper is intentionally NOT used here — its return type widens
// `required: true` to `required: boolean`, which breaks InputType/OutputType inference.
// Direct object literals with `required: true as const` preserve the literal type.
const cols = {
  name: { type: 'varchar' as const, required: true as const }, // required — mandatory on input, non-optional on output
  score: { type: 'int' as const },                              // optional — no required, no default
  createdAt: datetime(),                                        // has default CURRENT_TIMESTAMP — optional on input, non-optional on output
  active: boolean(false),                                       // has default 'false' — optional on input, non-optional on output
  notes: { type: 'text' as const, required: true as const },   // explicit required object
} as const;

describe('InputType inference', () => {
  test('required column is a mandatory key in InputType', () => {
    type IT = InputType<typeof cols>;
    // If 'name' were optional the assignment below would be invalid at compile time
    const check: IsExact<IT['name'], string> = true;
    expect(check).toBe(true);
  });

  test('datetime column is optional in InputType', () => {
    type IT = InputType<typeof cols>;
    // Optional keys have type T | undefined in the mapped result
    const check: IsExact<IT['createdAt'], Date | undefined> = true;
    expect(check).toBe(true);
  });

  test('boolean-with-default column is optional in InputType', () => {
    type IT = InputType<typeof cols>;
    const check: IsExact<IT['active'], boolean | undefined> = true;
    expect(check).toBe(true);
  });

  test('plain type-object column without required is optional in InputType', () => {
    type IT = InputType<typeof cols>;
    const check: IsExact<IT['score'], number | undefined> = true;
    expect(check).toBe(true);
  });

  test('explicit required:true object is mandatory in InputType', () => {
    type IT = InputType<typeof cols>;
    const check: IsExact<IT['notes'], string> = true;
    expect(check).toBe(true);
  });
});

describe('OutputType inference', () => {
  test('required column is non-optional in OutputType', () => {
    type OT = OutputType<typeof cols>;
    const check: IsExact<OT['name'], string> = true;
    expect(check).toBe(true);
  });

  test('datetime column with default is non-optional in OutputType', () => {
    type OT = OutputType<typeof cols>;
    const check: IsExact<OT['createdAt'], Date> = true;
    expect(check).toBe(true);
  });

  test('boolean-with-default column is non-optional in OutputType', () => {
    type OT = OutputType<typeof cols>;
    const check: IsExact<OT['active'], boolean> = true;
    expect(check).toBe(true);
  });

  test('plain type-object column without required or default is optional in OutputType', () => {
    type OT = OutputType<typeof cols>;
    const check: IsExact<OT['score'], number | undefined> = true;
    expect(check).toBe(true);
  });

  test('explicit required:true object column is non-optional in OutputType', () => {
    type OT = OutputType<typeof cols>;
    const check: IsExact<OT['notes'], string> = true;
    expect(check).toBe(true);
  });
});

describe('AutoColumns inference', () => {
  test('datetime() column appears in AutoColumns', () => {
    type AC = AutoColumns<typeof cols>;
    const check: IsExact<'createdAt' extends AC ? true : false, true> = true;
    expect(check).toBe(true);
  });

  test('boolean-with-default column appears in AutoColumns', () => {
    type AC = AutoColumns<typeof cols>;
    const check: IsExact<'active' extends AC ? true : false, true> = true;
    expect(check).toBe(true);
  });

  test('required varchar column does NOT appear in AutoColumns', () => {
    type AC = AutoColumns<typeof cols>;
    const check: IsExact<'name' extends AC ? true : false, false> = true;
    expect(check).toBe(true);
  });

  test('plain type-object column without default does NOT appear in AutoColumns', () => {
    type AC = AutoColumns<typeof cols>;
    const check: IsExact<'score' extends AC ? true : false, false> = true;
    expect(check).toBe(true);
  });

  test('date() with auto=true column appears in AutoColumns', () => {
    const dateCols = { createdOn: date(true), name: 'text' as const } as const;
    type AC = AutoColumns<typeof dateCols>;
    const check: IsExact<'createdOn' extends AC ? true : false, true> = true;
    expect(check).toBe(true);
  });

  test('date column without default does NOT appear in AutoColumns', () => {
    // date(false) cannot be narrowed at the type level (no overloads), so use a plain
    // { type: 'date' } object which has no default field at all.
    const dateCols = { scheduledOn: { type: 'date' as const }, name: 'text' as const } as const;
    type AC = AutoColumns<typeof dateCols>;
    const check: IsExact<'scheduledOn' extends AC ? true : false, false> = true;
    expect(check).toBe(true);
  });
});
