# Phase 5: Documentation and Packaging - Context

**Gathered:** 2026-03-23 (assumptions mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

The library is fully documented and `package.json` is correct for public ESM consumers — ready to publish to npm (actual publication handled by an external GitHub Action, not this phase).

Scope: JSDoc on all exported symbols, complete README rewrite, CHANGELOG.md creation, package.json cleanup, and `columnTypeToSQL()` validation for invalid type combinations.

No new features. No migration tooling. No publish scripts.

</domain>

<decisions>
## Implementation Decisions

### Package.json Cleanup

- **D-01:** Remove `"private": true` — blocks `npm publish` unconditionally.
- **D-02:** Add `"sideEffects": false` — enables tree-shaking in bundler consumers. The library has no module-load side effects after Phase 4 (configure() deleted, type parsers are per-pool).
- **D-03:** Add `"engines": { "node": ">=18" }` — library uses private class fields and requires Node 18+.
- **D-04:** Add a `"description"` field: `"Type-safe, ergonomic PostgreSQL client for TypeScript"`.
- **D-05:** Set version to `1.0.0-rc.1` (not `1.0.0` — user preference).
- **D-06:** No publish scripts, no `publishConfig`, no CI publish step — a GitHub Action owned by the user handles actual publication. This phase only makes the package publishable.

### JSDoc Coverage

- **D-07:** Add JSDoc (`@param`, `@returns`, at least one `@example`) to every symbol exported from the public barrel (`index.ts`). This covers: `Database` class and all its public methods, `TransactionClient` (exported for instanceof checks), `API<DB>` abstract class, all query functions (`select`, `execute`, `cursor`, `stream`, `chunk`, `step`, `first`), all table helpers (`createTable`, `createIndexes`, `alterColumn`, `insertIntoTable`, `bulkWrite`, `tableOutput`), all type constructors (`varchar`, `decimal`, `numeric`, `float`, `boolean`, `date`, `datetime`, `required`), and exported types (`PGType`, `PGTypeName`, `ColumnDefinition`, `IndexDefinition`, etc.).
- **D-08:** Internal helpers (not re-exported from barrel) do NOT need JSDoc — `buildTypeParser`, `parseConnectionString`, etc. are internal implementation details.
- **D-09:** JSDoc error messages use the same lowercase-imperative style as the existing codebase. `@example` blocks should show the realistic usage pattern (not toy examples).

### README

- **D-10:** Complete rewrite from scratch. Current content is rslib boilerplate and is not salvageable.
- **D-11:** README sections (in order): Installation, Quick Start (connect + basic query), Schema Definition, Query Modes (select / first / stream / chunk / step), Transactions, Bulk Operations (insertIntoTable + bulkWrite/COPY), LISTEN/NOTIFY, Type Parser Configuration (`new Database(url, { types: { INT8: ... } })`), `API<DB>` Repository Pattern, TypeScript Requirements.
- **D-12:** Code examples in README must be accurate — use the actual public API. Do NOT mention `configure()` (deleted in Phase 4). The type parser API is the `types:` constructor option.
- **D-13:** README does NOT include internal details (TransactionClient class internals, buildTypeParser, configure() history). Public API only.

### CHANGELOG

- **D-14:** Create `CHANGELOG.md` at project root with a single `v1.0.0-rc.1` entry.
- **D-15:** CHANGELOG format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) style. One `## [1.0.0-rc.1] - 2026-03-23` section with subsections: Added (public API surface), Changed (type parsers now per-pool), Removed (configure()).
- **D-16:** No prior versions to backfill — this is the inaugural release.

### columnTypeToSQL Validation

- **D-17:** Add a throw in `columnTypeToSQL()` for invalid type/param combinations. Specifically: `scale` is only valid for `numeric` and `decimal`; if a caller passes a `scale` with `varchar`, `float`, or any non-scale type, throw `'columnTypeToSQL: scale is only valid for numeric and decimal types'`.
- **D-18:** Check all existing call sites before adding the throw — `columnDefinitionToSQL` in `utils.ts` and all callers in `tables.ts` — to confirm no current caller passes an invalid combination (the TypeScript type system should already prevent this at compile time, but runtime callers need protection).

### Claude's Discretion

- Exact JSDoc wording for individual methods (keep consistent with existing error message style)
- Order of exports in README sections (above order is a guide, not a constraint)
- Whether CHANGELOG uses `###` subsections or a flat list
- `description` field exact wording (must convey "type-safe PostgreSQL" and "TypeScript")

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Public API Surface
- `index.ts` — barrel exports; everything re-exported here needs JSDoc
- `src/database.ts` — `Database` class, constructor, all public methods, `TransactionClient`
- `src/query.ts` — `select`, `execute`, `cursor`, `stream`, `chunk`, `step`, `first`
- `src/tables.ts` — `createTable`, `createIndexes`, `alterColumn`, `insertIntoTable`, `bulkWrite`, `tableOutput`
- `src/sql.ts` — `SQLQuery`, `SQLCTEDefinition`, `SQLTemplate`, `createSQLContext`
- `src/api.ts` — `API<DB>` abstract class
- `src/types.ts` — `PGType`, `PGTypeName`, `ColumnDefinition`, `IndexDefinition`, type constructors
- `src/utils.ts` lines 282–307 — `columnTypeToSQL()` (the validation fix target)

### Package Configuration
- `package.json` — current state; fields to add/modify per D-01 through D-06
- `rslib.config.ts` — ESM output config (read to understand build output format)

### Prior Phase Context
- `.planning/phases/04-type-safety-and-security/04-CONTEXT.md` — D-01 (configure() deleted), D-02 (types: constructor option), D-05 (PGTypeName export)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PGTypeName` export in `src/types.ts` — already JSDoc'd; use as the template for type-level docs
- Error message style from `src/database.ts`: lowercase imperative (`'Cannot initiate nested transaction'`, `'No callback'`) — apply consistently in JSDoc `@throws` tags
- Type constructors (`varchar()`, `decimal()`, etc.) in `src/types.ts` are the intended public API for column definitions — README examples should use these, not raw strings

### Established Patterns
- `export type` for type-only re-exports (required by project conventions per CLAUDE.md)
- `biome-ignore` comment format with `<explanation>` — already in use; don't add new suppressions for JSDoc
- No default exports — all exports are named; README examples must use named imports

### Integration Points
- `columnTypeToSQL()` is called from `columnDefinitionToSQL()` which is called from `createTable()` — the throw must not break the TypeScript compile-time-safe path
- `Database` constructor second param now uses `Omit<PoolConfig & ClientConfig, 'types'> & { debug?: boolean; types?: ... }` — JSDoc must reflect the actual signature from Phase 4 changes
- `TransactionClient` is exported from `src/database.ts` but NOT re-exported from `index.ts` (per Phase 3 decision D-04) — README should not document it as a user-facing class

</code_context>

<specifics>
## Specific Ideas

- Version is `1.0.0-rc.1` (not `1.0.0`) — user preference, set in package.json before any docs
- Publication is handled by an external GitHub Action — this phase only makes the package publishable (correct `package.json`, correct dist output)
- README type parser section: show the override example `new Database(url, { types: { INT8: (val) => BigInt(val) } })` — this was validated in Phase 4 integration tests
- CHANGELOG `Removed` section must mention `configure()` by name with reason: "replaced by per-pool `types:` constructor option"

</specifics>

<deferred>
## Deferred Ideas

- Automated API docs generation (TypeDoc, TSDoc) — out of scope; JSDoc in source + README is sufficient for v1.0.0-rc.1
- `publishConfig` for scoped package (`@lalex/oopg`) — not needed, GitHub Action handles publish config
- Semantic versioning automation (conventional commits, release-drafter) — future milestone
- `prepublishOnly` script to run tests before publish — not in scope; CI handles this

</deferred>

---

*Phase: 05-documentation-and-packaging*
*Context gathered: 2026-03-23*
