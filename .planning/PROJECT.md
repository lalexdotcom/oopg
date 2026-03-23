# oopg

## What This Is

A TypeScript-first PostgreSQL client library wrapping `node-pg` and its ecosystem. It provides type-safe schema definitions, SQL template literals, transaction management, streaming/cursor queries, and bulk operations — all with full TypeScript inference from column definitions. Intended for public release on npm.

## Core Value

Type-safe, ergonomic PostgreSQL access in TypeScript — the schema defines the types, the API enforces them.

## Requirements

### Validated

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

### Active

- [ ] Fix bad async patterns (`new Promise(async ...)` anti-pattern in `query.ts`, `database.ts`)
- [ ] Remove all `any` type casts — replace with proper generics or narrowing
- [x] Refactor transaction Proxy chain → explicit `TransactionClient` class (same external API) — Validated in Phase 3
- [x] Fix global type parser side effects (INT8, INT4, NUMERIC parsers set globally) — Validated in Phase 3 (`configure()`)
- [ ] Fix identifier injection risk in `sql.ts` and `utils.ts`
- [x] Fix error recovery in streaming/cursor ops (cursor leak if callback throws) — Validated in Phase 2
- ~~Fix `while((rows = await curs.read(size)).length)` assignment-in-condition pattern~~ — Cancelled (D-11: pattern retained)
- [x] Fix race condition on transaction `done` flag (`#done` private class field) — Validated in Phase 2
- [x] Fix typo: `'delate'` → `'delete'` in debug array (`query.ts:40`) — Validated in Phase 2
- [ ] Complete CTE implementation (alias, materialize methods currently disabled)
- [ ] Complete partial index implementation (`types.ts` TODOs)
- [x] Make `commit`/`rollback` idempotent (currently throws on double-call) — Validated in Phase 2
- [ ] Add runtime validation for invalid column type combinations
- [ ] Add block-level comments and JSDoc for all public functions
- [ ] Write README for public npm release
- [ ] Write tests for key functionality (current coverage: near zero)

### Out of Scope

- Multi-database support (MySQL, SQLite) — library is PostgreSQL-specific by design
- ORM-style migrations — raw SQL focus, migrations are out of scope
- Browser/edge runtime support — Node.js 18+ only
- Real-time subscriptions beyond LISTEN/NOTIFY — already supported via existing mechanism

## Context

Brownfield TypeScript library. Codebase cartographied 2026-03-23 — see `.planning/codebase/` for full analysis.

Key technical findings from codebase map:
- ~~Transaction handling uses 3–5 nested Proxy layers~~ — Replaced with `TransactionClient extends Database` in Phase 3
- SQL template type system is complex but functional — complex conditionals in `sql.ts:43-65`
- Global type parsers registered at module load affect all `pg` queries process-wide
- Test suite is essentially empty (1 test on a `squared()` utility)
- CTE and partial index features are type-system-ready but runtime-unimplemented
- Connection string parser is hand-rolled with multiple edge cases

## Constraints

- **API compatibility**: Transaction callback signature must remain `(transaction: Database, { commit, rollback }) => ...` — internal refactor only
- **Runtime**: Node.js 18+ — no browser/edge constraints
- **Build**: Rslib (ESM output) + Biome (lint/format) — no changes to build tooling
- **Language**: All code, comments, JSDoc, README in English

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace transaction Proxy with TransactionClient class | Proxy chain is fragile, untyped, hard to debug; TransactionClient keeps same API | — Pending |
| Complete CTE/partial index rather than remove | Features are type-system-ready; removal would be a breaking change for any current users | — Pending |
| Keep global type parsers but document the behavior | Changing behavior is a breaking change; document clearly instead | — Pending |

---

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
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
*Last updated: 2026-03-23 after Phase 3 completion*
