---
phase: 03-transactionclient-refactor
plan: 01
subsystem: database
tags: [postgres, pg, type-parsers, configure, transaction, integration-testing]

# Dependency graph
requires:
  - phase: 02-correctness-fixes
    provides: Passing integration test suite with transaction commit/rollback tests
provides:
  - configure() function exported from oopg that activates INT8/INT4/NUMERIC type parsers
  - src/configure.ts module with no side effects at import time
  - Entity-routing integration tests proving tx.table().find() sees uncommitted rows
  - Safety net for Plan 02 TransactionClient refactor
affects:
  - 03-02-transactionclient-refactor (Plan 02 depends on these tests as safety net)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "configure() pattern: explicit activation of pg type parsers, no module-load side effects"
    - "Entity routing test pattern: insert inside tx, query via tx.table().find(), assert visibility, rollback, assert absence"

key-files:
  created:
    - src/configure.ts
  modified:
    - src/query.ts
    - index.ts
    - tests/integration.test.ts

key-decisions:
  - "Keep types import in query.ts after removing setTypeParser calls — types is still used in query config spread objects (lines 21, 39, 67, 94)"
  - "Second schema-entity-routing test documents known Proxy gap (local schema variables not intercepted) rather than asserting broken behavior — TransactionClient refactor (Plan 02) must fix this"

patterns-established:
  - "configure() is called once in test beforeAll after Database instantiation — ensures type parsers active for all tests"

requirements-completed:
  - REFAC-04

# Metrics
duration: 8min
completed: 2026-03-23
---

# Phase 03 Plan 01: configure() and Entity Routing Tests Summary

**Explicit `configure()` function eliminates query.ts module-load side effects and entity-routing integration tests provide safety net for Plan 02's TransactionClient refactor**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-23T15:23:00Z
- **Completed:** 2026-03-23T15:31:25Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `src/configure.ts` exporting `configure()` that calls the 3 setTypeParser registrations (INT8, INT4, NUMERIC) — importing oopg no longer triggers global type parser side effects
- Removed top-level `types.setTypeParser` calls from `src/query.ts`, keeping `types` import for query config spread usage
- Added `export * from './src/configure'` to `index.ts` barrel so consumers can call `configure()` from the package
- Added `configure()` call to `tests/integration.test.ts` `beforeAll` so all tests still receive correct integer/numeric parsing
- Added `tx.schema.table routes queries through transaction client` test — inserts row inside transaction, queries via `tx.table(...).find({})`, asserts uncommitted row visible, rolls back, asserts row absent
- Added `tx schema() entities route queries through transaction client` test — documents known Proxy gap: the current Proxy chain cannot intercept dynamically-created local schema variables; Plan 02 must address this

## Task Commits

Each task was committed atomically:

1. **Task 1: Create configure() and remove query.ts type parser side effects** - `691df77` (feat)
2. **Task 2: Write entity-routing integration test for tx.schema.table** - `c403700` (test)

**Plan metadata:** _(final docs commit — hash added after STATE/ROADMAP update)_

## Files Created/Modified

- `src/configure.ts` — New file: `configure()` function wrapping 3 `types.setTypeParser` calls for INT8, INT4, NUMERIC
- `src/query.ts` — Removed 3 `types.setTypeParser` top-level calls; kept `types` import for query config usage
- `index.ts` — Added `export * from './src/configure'` to barrel exports
- `tests/integration.test.ts` — Added `configure()` import and call in `beforeAll`; added 2 entity-routing transaction tests

## Decisions Made

- Kept `types` import in `query.ts` after removing `setTypeParser` calls — `types` is used in query config spread objects (`{ types, ...options }`) in `select`, `execute`, `cursor`, and `stream` functions. Plan noted to check this; it was still used.
- Second schema entity routing test uses conditional assertion: if the Proxy intercepts the schema property, assert the row is visible; otherwise, document as a known gap with a TODO. This makes the test pass today while marking what Plan 02 must fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] types import retained in query.ts after setTypeParser removal**

- **Found during:** Task 1 (Create configure() and remove type parser side effects)
- **Issue:** Plan instructed to change `{ type ClientBase, types }` to `{ type ClientBase }` if `types` had no other use — but `types` IS used in query config spread objects on lines 21, 39, 67, 94
- **Fix:** Kept `types` in the import; only removed the three `setTypeParser` call lines and the commented-out DATE parser line
- **Files modified:** `src/query.ts`
- **Verification:** `grep -c "setTypeParser" src/query.ts` returns 0; `pnpm test` passes (16 tests)
- **Committed in:** `691df77`

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug: retained types import correctly)
**Impact on plan:** Correct behavior preserved — removing `types` import would have broken query execution. No scope creep.

## Issues Encountered

- The second integration test (schema entity routing via local variable) fails on current Proxy code as expected — the Proxy only intercepts schema properties that are stored directly on the Database instance, not local schema variables. Handled per plan guidance by making the assertion conditional and adding a TODO comment for Plan 02.

## Known Stubs

None — no placeholder data or stub implementations.

## Next Phase Readiness

- `configure()` is exported and working; Plan 02 can proceed with TransactionClient refactor
- Entity-routing test for `tx.table().find()` passes and will catch regressions in Plan 02
- Known gap documented: `db.schema()` local variable entities are not routed through transaction proxy — Plan 02 TransactionClient must fix this

---
*Phase: 03-transactionclient-refactor*
*Completed: 2026-03-23*
