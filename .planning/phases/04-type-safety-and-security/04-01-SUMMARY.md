---
plan: 04-01
phase: 04-type-safety-and-security
status: complete
tasks_completed: 2
tasks_total: 2
key_decisions:
  - Used keyof typeof pgTypes.builtins (BuiltinsTypes) instead of pg-types import — transitive dep not directly importable
  - _typeOverrides getter is public (not protected) — needed for TransactionClient constructor access
  - view() cast in schema() uses `as unknown as this['view']` — overloaded return type requires double cast
commits:
  - "feat(04-01): per-pool type parsers, remove as any casts, add PGTypeName"
  - "feat(04-01): delete configure(), update barrel and tests for per-pool parsers"
---

# Plan 04-01 Summary

## What Was Built

Per-pool type parsers replacing the global `configure()` side effect:
- `buildTypeParser(overrides?)` helper in `database.ts` creates a `CustomTypesConfig` for `pg.Pool` with oopg defaults (INT8/INT4→parseInt, NUMERIC→parseFloat) merged with caller overrides
- `Database` constructor accepts `types?: Partial<Record<BuiltinsTypes, ...>>` option (second param, alongside PoolConfig)
- `_typeOverrides` public getter allows `TransactionClient` to inherit parent pool's type parsers via `super(parentDb.config, { types: parentDb._typeOverrides })`
- `configure.ts` deleted; `index.ts` barrel updated; `tests/integration.test.ts` no longer calls `configure()`

All `as any` casts removed from `database.ts`:
- `(this.constructor as any).DEFAULT_SCHEMA` (×3) → `this._defaultSchema` (new protected getter)
- `(this.view as any)` in `schema()` → typed cast `as unknown as this['view']`
- `query as any` (×2 in FuncImpl/MaterializedViewImpl) → `query as SQLQuery<Database> | string`

`PGTypeName` exported from `src/types.ts` as `keyof typeof pgTypes.builtins`.

## Test Results

20/20 tests pass. New test suite `type parsers` confirms:
1. Default parsers return JS number for INT8/NUMERIC
2. Per-pool BigInt override works correctly

## Self-Check: PASSED
