---
phase: 02-correctness-fixes
plan: 02
subsystem: database
tags: [postgres, transactions, cursor, typescript, private-fields]

# Dependency graph
requires:
  - phase: 02-correctness-fixes
    provides: Fixed chunk() async/try-finally cursor close (BUG-02 partial)
provides:
  - Idempotent commit() and rollback() — second call silently returns (BUG-03)
  - Transaction done state promoted to private class field #done (BUG-02)
  - Memoize feature fully removed from database.ts (BUG-01)
  - Regression tests for double commit/rollback silent no-op and cursor-leak-on-throw
affects: [03-transaction-refactor, 05-cte-completion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Private class field #done for transaction state instead of closure variable"
    - "Idempotent guard pattern: if (this.#done) return; — silent no-op on duplicate calls"

key-files:
  created: []
  modified:
    - src/database.ts
    - tests/integration.test.ts

key-decisions:
  - "commit() and rollback() return silently on second call rather than throw — matches plan decision D-05/D-06"
  - "Memoize block removed entirely — undocumented feature with async anti-pattern, no public API surface"
  - "Unused imports (EOL, through/ThroughStream, formatEntity) removed after memoize deletion"

patterns-established:
  - "Transaction idempotency: guard with private field, return silently, never throw on double-call"

requirements-completed: [BUG-01, BUG-02, BUG-03]

# Metrics
duration: 12min
completed: 2026-03-23
---

# Phase 02 Plan 02: database.ts Correctness Fixes Summary

**Removed the undocumented memoize feature (140-line block with async anti-pattern), promoted transaction done-flag to private class field #done, and made commit/rollback idempotent — all with regression tests.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-23T14:37:00Z
- **Completed:** 2026-03-23T14:49:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Removed entire memoize block (lines 338-476) and all its artifacts: `DatabaseSelectOptions.memoize` type, unused `EOL`/`through`/`ThroughStream`/`formatEntity` imports
- Fixed bare `done` variable references in transaction try/catch that would have caused `ReferenceError` at runtime — replaced with `this.#done`
- Made `commit()` and `rollback()` idempotent: `if (this.#done) return;` instead of throwing
- Added regression tests: double commit silent, double rollback silent, cursor closed when chunk callback throws

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix transaction state and remove memoize in database.ts** - `9f8925a` (fix)
2. **Task 2: Add regression tests and update existing double-commit/rollback tests** - `4c786f3` (test)

**Plan metadata:** (committed with state update)

## Files Created/Modified
- `src/database.ts` - Memoize block removed, `done` references fixed to `this.#done`, unused imports removed
- `tests/integration.test.ts` - 2 tests renamed (silent no-op), 1 new cursor-leak regression test added

## Decisions Made
- Removed `formatEntity` import after memoize removal — it was only used inside the memoize block, confirmed zero remaining usages
- Applied `biome format --write` after removing the `through` import line to fix blank-line formatting issue flagged by biome check

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed bare `done` references in transaction try/catch**
- **Found during:** Task 1 (Fix transaction state and remove memoize in database.ts)
- **Issue:** The plan showed `done` had already been changed to `this.#done` in the commit/rollback closures, but lines 278 and 287 in the try/catch block still referenced bare `done` (undefined variable) — would throw `ReferenceError` at runtime on any transaction that auto-commits or catches an error
- **Fix:** Replaced `if (!done)` with `if (!this.#done)` at both references in the try/catch block
- **Files modified:** src/database.ts
- **Verification:** `grep -c "if (!done)" src/database.ts` returns 0
- **Committed in:** 9f8925a (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Critical correctness fix — without it, every transaction would ReferenceError. No scope creep.

## Issues Encountered
- The `through` import removal created a blank line that biome's formatter flagged as a format error — resolved with `pnpm exec biome format --write src/database.ts`
- The other agent worktree (`agent-a245ad76`) has a stale `tests/integration.test.ts` that rstest picks up and fails — our 14 tests all pass (0 failures in our test file)

## Next Phase Readiness
- BUG-01, BUG-02, BUG-03 fully resolved
- src/database.ts is clean: no memoize, no async anti-patterns, private #done field, idempotent commit/rollback
- Ready for Phase 03: TransactionClient refactor (which depends on stable transaction behavior)

---
*Phase: 02-correctness-fixes*
*Completed: 2026-03-23*
