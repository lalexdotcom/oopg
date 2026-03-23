# Requirements: oopg

**Defined:** 2026-03-23
**Core Value:** Type-safe, ergonomic PostgreSQL access in TypeScript — the schema defines the types, the API enforces them.

## v1 Requirements

### Infrastructure

- [x] **INFRA-01**: Devcontainer is reconfigured as a docker compose setup with a PostgreSQL service available to tests
- [x] **INFRA-02**: Test harness uses a real PostgreSQL instance via `TEST_DATABASE_URL`, with per-test schema isolation (each test creates and drops its own `pg_temp_*` schema)

### Tests

- [x] **TEST-01**: Transaction behavior is covered: successful commit, explicit rollback, double-call on commit/rollback, and nested transaction attempt throws
- [x] **TEST-02**: All 5 query execution modes are covered: `select`, `stream`, `chunk`, `step`, `first`
- [x] **TEST-03**: Bulk operations are covered: `insertIntoTable` with multiple rows, `bulkWrite` with COPY protocol

### Bug Fixes

- [x] **BUG-01**: `new Promise(async (res, rej) => ...)` anti-pattern replaced with direct async functions using `try/finally` in `query.ts` and `database.ts`
- [x] **BUG-02**: Cursor is guaranteed to close even when a `chunk`/`step` callback throws; transaction `done` flag replaced with a private class field (`#done`) to eliminate the race condition across `await` boundaries
- [x] **BUG-03**: Calling `commit()` or `rollback()` a second time silently returns (no-op) instead of throwing
- [x] **BUG-04**: Typo `'delate'` corrected to `'delete'` in the debug command array (`query.ts:40`)

### Refactoring

- [ ] **REFAC-01**: Transaction Proxy chain (3–5 nested layers) replaced with an explicit `TransactionClient extends Database` class; external API (`callback(transaction: Database, { commit, rollback })`) is unchanged
- [ ] **REFAC-02**: `connect()` method Proxy (`database.ts:647`) cleaned up using the same pattern as the TransactionClient replacement
- [ ] **REFAC-03**: Assignment-in-while-condition (`while ((rows = await curs.read(size)).length)`) refactored to an explicit `while (true)` with a `break` condition
- [x] **REFAC-04**: Global `types.setTypeParser()` calls moved from module-level side effects into an exported `configure()` function; existing behavior preserved as opt-in default

### Type Safety

- [ ] **TYPE-01**: All `(this.constructor as any)` casts in `database.ts` replaced with a typed static interface or equivalent pattern
- [ ] **TYPE-02**: `sql.ts` default switch case throws an explicit error for unknown value types instead of silently interpolating (SQL injection risk)
- [ ] **TYPE-03**: CTE runtime implementation completed — `alias()` and `materialize()` methods functional, not just type-level stubs
- [ ] **TYPE-04**: Partial index runtime implementation completed — WHERE clause is validated and rendered into the generated SQL

### Documentation

- [ ] **DOC-01**: All exported functions, classes, and types have JSDoc with `@param`, `@returns`, and at least one usage example; block-level comments in each source file describe the purpose of each logical section
- [ ] **DOC-02**: README covers: installation, quick start, schema definition, query modes, transactions, bulk operations, streaming, LISTEN/NOTIFY, `configure()`, and the `API<DB>` base class — with code examples for each
- [ ] **DOC-03**: `CHANGELOG.md` initialized with a v1.0.0 entry summarizing all changes

### Packaging

- [ ] **PKG-01**: `package.json` `exports` field verified and corrected for ESM consumers (main entry, types entry, sub-path exports if any)
- [ ] **PKG-02**: `sideEffects: false` added to `package.json` after `configure()` implementation removes global type parser side effects from module load
- [ ] **PKG-03**: Runtime validation added to `columnTypeToSQL()` — invalid type combinations (e.g., `varchar + scale`) throw a descriptive error instead of generating invalid SQL

## v2 Requirements

### Developer Experience

- **DX-01**: `Symbol.asyncDispose` / `using` keyword support for cursor and connection lifecycle cleanup (requires Node.js 22+ consumers)
- **DX-02**: Variadic generics for `func()` overloads — replace 10 explicit arity overloads with variadic tuple types
- **DX-03**: `getTransactionState()` method to inspect current transaction status (committed / rolled back / active)

### Testing

- **TEST-04**: Stress tests for connection pool under concurrent load (connection leak detection)
- **TEST-05**: Regression tests for EventEmitter LISTEN/NOTIFY race condition (duplicate connections on concurrent `listen()` calls)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-database support (MySQL, SQLite) | Library is PostgreSQL-specific by design |
| ORM-style migrations | Raw SQL focus; migrations are a separate concern |
| Browser/edge runtime | Node.js 18+ only — no bundler optimizations needed |
| Real-time beyond LISTEN/NOTIFY | Already supported; WebSocket/SSE not in scope |
| Competitor claims in README | Cannot verify accuracy without live web access at publish time — defer to manual review |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| TEST-03 | Phase 1 | Complete |
| BUG-01 | Phase 2 | Complete |
| BUG-02 | Phase 2 | Complete |
| BUG-03 | Phase 2 | Complete |
| BUG-04 | Phase 2 | Complete |
| REFAC-01 | Phase 3 | Pending |
| REFAC-02 | Phase 3 | Pending |
| REFAC-03 | Phase 3 | Pending |
| REFAC-04 | Phase 3 | Complete |
| TYPE-01 | Phase 4 | Pending |
| TYPE-02 | Phase 4 | Pending |
| TYPE-03 | Phase 4 | Pending |
| TYPE-04 | Phase 4 | Pending |
| DOC-01 | Phase 5 | Pending |
| DOC-02 | Phase 5 | Pending |
| DOC-03 | Phase 5 | Pending |
| PKG-01 | Phase 5 | Pending |
| PKG-02 | Phase 5 | Pending |
| PKG-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-23 after initial definition*
