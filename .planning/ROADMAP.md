# Roadmap: oopg

## Overview

oopg is a feature-complete TypeScript PostgreSQL client that needs correctness hardening and documentation before public npm release. The path runs in a strict dependency chain: test infrastructure first (so every subsequent change is verifiable), then bug fixes (correctness before documentation), then the high-risk TransactionClient refactor (after bugs are fixed and tests exist), then type safety and security cleanup, and finally documentation and packaging once everything underneath is correct.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Test Infrastructure** - Real PostgreSQL test harness with schema isolation and integration coverage
- [ ] **Phase 2: Correctness Fixes** - All latent bugs fixed before they become documented API behavior
- [ ] **Phase 3: TransactionClient Refactor** - Proxy chain replaced with explicit typed class; external API unchanged
- [ ] **Phase 4: Type Safety and Security** - All `any` casts replaced; SQL injection risk closed; incomplete features implemented
- [ ] **Phase 5: Documentation and Packaging** - JSDoc, README, CHANGELOG, and package.json ready for public npm release

## Phase Details

### Phase 1: Test Infrastructure
**Goal**: Developers can run integration tests against a real PostgreSQL instance with per-test schema isolation and CI exits cleanly
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Running `pnpm test` in the devcontainer connects to a real PostgreSQL service (not a mock) via `TEST_DATABASE_URL`
  2. Each test creates and drops its own `pg_temp_*` schema — test failures in one test do not corrupt state for another
  3. Transaction behavior is covered: successful commit, explicit rollback, double-call on commit/rollback, and nested transaction attempt
  4. All five query modes are exercised in tests: `select`, `stream`, `chunk`, `step`, `first`
  5. Bulk operations are covered: multi-row `insertIntoTable` and `bulkWrite` via COPY protocol
**Plans:** 2 plans
Plans:
- [x] 01-01-PLAN.md — Devcontainer docker-compose, rstest config, scaffolding cleanup, withSchema helper
- [x] 01-02-PLAN.md — Integration tests for transactions, query modes, and bulk operations

### Phase 2: Correctness Fixes
**Goal**: All latent correctness bugs are eliminated so subsequent refactoring and documentation describe correct behavior
**Depends on**: Phase 1
**Requirements**: BUG-01, BUG-02, BUG-03, BUG-04
**Success Criteria** (what must be TRUE):
  1. Calling `commit()` or `rollback()` a second time silently returns — no exception is thrown and the transaction state is unchanged
  2. A `chunk()` or `step()` callback that throws does not leak the cursor — the cursor is always closed in a `finally` block
  3. No `new Promise(async (res, rej) => ...)` pattern exists anywhere in the codebase — all async entry points use `async function + try/finally`
  4. The debug command array in `query.ts` contains `'delete'` not `'delate'`
**Plans:** 1/2 plans executed
Plans:
- [x] 02-01-PLAN.md — Fix query.ts: typo, async anti-pattern in chunk(), cursor leak
- [ ] 02-02-PLAN.md — Fix database.ts: idempotent commit/rollback, #done field, memoize removal, regression tests

### Phase 3: TransactionClient Refactor
**Goal**: The transaction implementation uses an explicit `TransactionClient extends Database` class instead of 3–5 nested Proxy layers, with the external callback API unchanged
**Depends on**: Phase 2
**Requirements**: REFAC-01, REFAC-02, REFAC-03, REFAC-04
**Success Criteria** (what must be TRUE):
  1. Calling `tx.schema.table.select()` inside a transaction executes against the transaction client — not the pool — verified by an integration test
  2. `instanceof TransactionClient` returns true for the transaction object passed to the callback
  3. Stack traces inside transaction callbacks show `TransactionClient` method names, not anonymous Proxy traps
  4. Global type parsers are registered via an explicit `configure()` call, not at module load time — importing the library no longer has side effects
**Plans**: TBD

### Phase 4: Type Safety and Security
**Goal**: All unsafe type casts are replaced with typed alternatives, SQL injection surface is closed, and incomplete runtime features are implemented
**Depends on**: Phase 3
**Requirements**: TYPE-01, TYPE-02, TYPE-03, TYPE-04
**Success Criteria** (what must be TRUE):
  1. `tsc --declaration` output is identical before and after — no downstream `.d.ts` regressions from `any` removal
  2. Passing an object with a custom `toString()` as a SQL template parameter throws an explicit error — no silent string interpolation
  3. CTE `alias()` and `materialize()` methods produce valid SQL at runtime, not just type-level stubs
  4. Partial index `WHERE` clause is rendered into generated SQL — no more `WHERE undefined` in produced DDL
**Plans**: TBD

### Phase 5: Documentation and Packaging
**Goal**: The library is fully documented and the package.json is correct for public ESM consumers — ready to publish to npm
**Depends on**: Phase 4
**Requirements**: DOC-01, DOC-02, DOC-03, PKG-01, PKG-02, PKG-03
**Success Criteria** (what must be TRUE):
  1. Every exported function, class, and type has JSDoc with `@param`, `@returns`, and at least one `@example` — IDE hover shows correct, non-misleading information
  2. The README covers all major capabilities with code examples that compile and run correctly: quick start, schema definition, all query modes, transactions, bulk operations, streaming, LISTEN/NOTIFY, `configure()`, and `API<DB>`
  3. `CHANGELOG.md` exists with a v1.0.0 entry summarizing all changes made across phases 1–4
  4. `package.json` `exports` field correctly resolves for ESM consumers; `sideEffects: false` is present; `engines.node` is set to `>=18`
  5. `columnTypeToSQL()` throws a descriptive error for invalid type combinations (e.g., `varchar + scale`) instead of generating invalid SQL
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Test Infrastructure | 2/2 | Complete |  |
| 2. Correctness Fixes | 1/2 | In Progress|  |
| 3. TransactionClient Refactor | 0/TBD | Not started | - |
| 4. Type Safety and Security | 0/TBD | Not started | - |
| 5. Documentation and Packaging | 0/TBD | Not started | - |
