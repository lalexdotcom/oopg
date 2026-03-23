# oopg

## What This Is

A TypeScript-first PostgreSQL client library wrapping `node-pg` and its ecosystem. It provides type-safe schema definitions, SQL template literals, transaction management, streaming/cursor queries, and bulk operations — all with full TypeScript inference from column definitions. Published to npm as `@lalex/oopg`.

## Core Value

Type-safe, ergonomic PostgreSQL access in TypeScript — the schema defines the types, the API enforces them.

## Current State

**v1.0.0-rc.1 shipped 2026-03-23.**

- 6,245 lines TypeScript across `src/`, `tests/`, and `index.ts`
- 68 integration tests (all green) — real PostgreSQL, per-test schema isolation
- Full JSDoc on all exported symbols; complete 10-section README
- Publishable `package.json`: `sideEffects: false`, `engines.node >=18`, `type: module`
- `TransactionClient extends Database` replaces 3–5 nested Proxy layers
- `configure()` opt-in for type parsers (no module-load side effects)
- SQL injection guard, CTE/partial index runtime, `columnTypeToSQL` validation

## Requirements

### Validated (v1.0.0)

- ✓ Connection pooling via `pg.Pool` — existing
- ✓ Type-safe SQL template literals (`db.sql\`...\``) — existing
- ✓ Schema definition with inferred TypeScript types — existing
- ✓ Transaction support with commit/rollback — existing
- ✓ Table / View / MaterializedView / Function entities — existing
- ✓ Streaming queries via `pg-query-stream` — existing
- ✓ Cursor-based batch processing (`chunk`, `step`) — existing
- ✓ Bulk write via PostgreSQL COPY — existing
- ✓ LISTEN/NOTIFY event system — existing
- ✓ Multiple query modes: `select`, `stream`, `cursor`, `chunk`, `step`, `first` — existing
- ✓ Abstract `API<DB>` base class for repository pattern — existing
- ✓ INFRA-01/02: Real PostgreSQL test harness with per-test schema isolation — v1.0.0
- ✓ TEST-01/02/03: Integration tests for all query modes, transactions, bulk ops — v1.0.0
- ✓ BUG-01/02/03/04: Async anti-patterns, cursor leak, idempotent commit/rollback, typo — v1.0.0
- ✓ REFAC-01/02/04: TransactionClient class, connect() cleanup, configure() — v1.0.0
- ✓ TYPE-01/02/03/04: any-cast removal, SQL injection guard, CTE/partial index runtime — v1.0.0
- ✓ DOC-01/02/03: JSDoc, README (10 sections), CHANGELOG — v1.0.0
- ✓ PKG-01/02/03: exports field, sideEffects, columnTypeToSQL validation — v1.0.0

### Active (v2.0)

- [ ] DX-01: `Symbol.asyncDispose` / `using` keyword support for cursor and connection lifecycle (Node.js 22+)
- [ ] DX-02: Variadic generics for `func()` overloads — replace 10 explicit arity overloads
- [ ] DX-03: `getTransactionState()` — inspect current transaction status
- [ ] TEST-04: Connection pool stress tests (leak detection under concurrency)
- [ ] TEST-05: LISTEN/NOTIFY race condition regression tests (duplicate connections on concurrent `listen()`)

### Out of Scope

- Multi-database support (MySQL, SQLite) — library is PostgreSQL-specific by design
- ORM-style migrations — raw SQL focus, migrations are out of scope
- Browser/edge runtime support — Node.js 18+ only
- Real-time subscriptions beyond LISTEN/NOTIFY — already supported via existing mechanism

## Constraints

- **API compatibility**: Transaction callback signature must remain `(transaction: Database, { commit, rollback }) => ...` — internal refactor only
- **Runtime**: Node.js 18+ — no browser/edge constraints
- **Build**: Rslib (ESM output) + Biome (lint/format) — no changes to build tooling
- **Language**: All code, comments, JSDoc, README in English

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace transaction Proxy with TransactionClient class | Proxy chain is fragile, untyped, hard to debug; TransactionClient keeps same API | ✓ Shipped v1.0.0 — cleaner stack traces, typed, no behavior change |
| Complete CTE/partial index rather than remove | Features are type-system-ready; removal would be a breaking change | ✓ Shipped v1.0.0 — runtime implementation complete |
| Move type parsers to explicit `configure()` call | Removing global side effects required for `sideEffects: false` | ✓ Shipped v1.0.0 — opt-in only, no breaking change |
| SQL injection guard throws on untyped interpolation | `toString()` objects could silently inject SQL | ✓ Shipped v1.0.0 — explicit error for unsafe interpolation |
| `configure()` deleted from public API in Phase 4 | Phase 4 adopted per-pool parser approach; `configure()` was redundant | ✓ Phase 4 — README does not document it |
| `columnTypeToSQL` scale guard throws instead of silent invalid SQL | Descriptive error is better than silently generated DDL that PostgreSQL rejects | ✓ Shipped v1.0.0 |

---

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-23 after v1.0.0 milestone — all 22 v1 requirements delivered, ready to publish*
