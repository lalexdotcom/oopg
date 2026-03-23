# Phase 4: Type Safety and Security - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

All unsafe type casts replaced with typed alternatives, SQL injection surface closed, and incomplete runtime features (CTE, partial index) fully implemented. No new features — correctness and completeness only.

Includes replacing configure() + global type parsers with per-pool type parsers wired directly in the Database constructor.

</domain>

<decisions>
## Implementation Decisions

### Type Parser Architecture (replaces REFAC-04 configure())

- **D-01:** `configure()` is **removed entirely** (`src/configure.ts` deleted, barrel export removed from `index.ts`). It was added in Phase 3 and is immediately superseded. No users exist yet — no deprecation period needed.

- **D-02:** Type parsers are applied **per-pool** via a `types` option in the Database constructor's second parameter (alongside existing `PoolConfig` fields). The option type is `Partial<Record<builtinsTypes, (val: string) => unknown>>` where `builtinsTypes` comes from `pg-types`.

- **D-03:** oopg ships **opinionated defaults** (INT8→`Number.parseInt`, INT4→`Number.parseInt`, NUMERIC→`Number.parseFloat`). These apply unless overridden. The user can pass `{ INT8: (val) => BigInt(val) }` to override only INT8 while keeping the other defaults.

- **D-04:** Implementation: a `buildTypeParser(overrides?)` helper (internal, not exported) builds a `CustomTypesConfig` object for `new Pool({ ...config, types: buildTypeParser(poolConfig?.types) })`. Fallback chain: custom override → oopg default → `pgTypes.getTypeParser(id, format)`.

- **D-05:** `builtinsTypes` from `pg-types` is **re-exported** from `src/types.ts` as `export type { builtinsTypes as PGTypeName }` so users don't need to import from `pg-types` directly.

- **D-06:** `TransactionClient` constructor calls `super(parentDb.config)` — the super() call goes through the new constructor and creates a pool with the correct type parsers automatically. No special handling needed.

### SQL Injection Guard (TYPE-02)

- **D-07:** The `default` case in `sqlTaggedTemplate` currently does `${paramValue}` (raw string interpolation). Replace with: `throw new Error('SQL template parameter must be a primitive, Date, array, or SQL fragment — objects are not allowed to prevent injection')`.

- **D-08:** Also tighten the TypeScript parameter type in the SQL template signature to exclude plain objects. The type `SQLParam<T>` (`Exclude<any, T>` at `sql.ts:104`) needs to become a union of the explicitly allowed types: `string | number | boolean | null | Date | unknown[] | QueryResult | SQLFragment`.

### CTE Implementation (TYPE-03)

- **D-09:** Implement the **existing stubs** — keep the `SQLCTEDefinition<T>` interface shape. Do NOT redesign the ergonomics. The stubs already declare the right methods; just fill in the bodies.

- **D-10:** `alias(name: string): SQLCTEDefinition<T>` — sets the CTE alias name (stored on the CTE object). Returns `this` (chainable). When the CTE is interpolated into a SQL template, it renders as `"name" AS (SELECT ...)`.

- **D-11:** `use(materialized?: boolean): void` — the return type in the current stub is wrong (`void`). Change to return a SQL fragment that renders `"name" AS (SELECT ...)` or `"name" AS MATERIALIZED (SELECT ...)` / `"name" AS NOT MATERIALIZED (SELECT ...)`. This fragment can be used as `WITH ${myCte.use(true)} SELECT ...`.

- **D-12:** The auto-generated alias (`cte_0`, `cte_1`, etc.) is fine as the default when `.alias()` is not called. The Proxy in the current implementation should be removed in favor of a plain object if possible, but if the Proxy is the simplest path to keeping the type signature working, it may stay.

### Partial Index WHERE (TYPE-04)

- **D-13:** Verify `createIndexes()` in `tables.ts` correctly renders `WHERE ${where}` when the `where` field is a non-empty string. The current ternary `indexConditions ? \`WHERE ${indexConditions}\` : ''` looks correct but needs an integration test to confirm no `WHERE undefined` can appear in practice.

- **D-14:** Add an integration test: create a table with a partial index (`where: 'active = true'`), verify the generated DDL contains the WHERE clause. This closes TYPE-04 definitively.

### `any` Cast Removal (TYPE-01)

- **D-15:** Target the `any` casts in `database.ts` in priority order:
  1. `(this.constructor as any).DEFAULT_SCHEMA` (appears 3× at ~658, 683, 804) — fix by declaring a typed static property accessor or using a typed helper function.
  2. `(this.view as any)` in `schema()` (~625) — fix by correctly typing the overloaded `view()` call.
  3. `query as any` in tables.ts (1226, 1482) — fix by using the correct `pg.QueryConfig` or `pg.QueryArrayConfig` type.

- **D-16:** Goal: `tsc --declaration` output must be identical before and after (no regressions in generated `.d.ts` files). Run `tsc --declaration --emitDeclarationOnly` before and after as the acceptance criterion.

- **D-17:** `type SQLParam<T> = Exclude<any, T>` at `sql.ts:104` is never useful (Exclude<any, anything> = any). This is related to D-08 — fix it as part of the injection guard work.

### Claude's Discretion

- Internal structure of `buildTypeParser()` helper — can be a module-level function or inline in the constructor
- Whether to keep the `OOPG_DEFAULTS` constant at module level or inline
- Error message wording for the SQL injection throw (must include "SQL template" and "injection" keywords for discoverability)
- Whether `DEFAULT_SCHEMA` accessor uses `protected static` or `protected` instance getter

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Type Parsers
- `src/configure.ts` — File to DELETE (content: 7 lines, exports `configure()`)
- `index.ts` — Remove `export * from './src/configure'` line
- `src/database.ts` — Constructor signature (lines 99–186), TransactionClient constructor (lines 829–878)
- `node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/index.d.ts` — `builtinsTypes` union, `TypeId` enum, `getTypeParser` signature
- `node_modules/.pnpm/@types+pg@8.20.0/node_modules/@types/pg/index.d.ts` — `CustomTypesConfig`, `PoolConfig.types` field (lines 67–68)

### SQL Injection
- `src/sql.ts:152–224` — `sqlTaggedTemplate` function, all case branches, the `default` case to fix
- `src/sql.ts:95–104` — `SQLParam<T>` type definition to replace

### CTE
- `src/sql.ts:32–41` — `SQLCTEDefinition<T>` and `SQLCTE` type stubs
- `src/sql.ts:695–760` — CTE implementation (cteAliasIndex, Proxy, commented-out materialize logic)

### `any` Casts
- `src/database.ts:625` — `(this.view as any)` in schema()
- `src/database.ts:658,683,804` — `(this.constructor as any).DEFAULT_SCHEMA`
- `src/tables.ts:1226,1482` — `query as any` casts

### Partial Index
- `src/tables.ts:29–68` — `createIndexes()` function, the WHERE rendering at line 62
- `src/types.ts:85–99` — `IndexDefinition` type with `where?: string` field

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pg.CustomTypesConfig` interface (`@types/pg`) — already the right shape for per-pool type parsers; `Pool` constructor accepts it as `types` field
- `pgTypes.getTypeParser(id, format)` — the correct fallback for types not in oopg's defaults
- `pgTypes.builtins` — maps `builtinsTypes` string names to OID numbers (needed in `buildTypeParser`)
- `DatabaseElementHelper.database` field — already receives `TransactionClient` correctly (Phase 3 fix); type parsers flow through the pool automatically

### Established Patterns
- Constructor receives `config: string | ClientConfig, poolConfig?: PoolConfig & ClientConfig & { debug?: boolean }` — add `types?` to the poolConfig shape without breaking the existing spread
- `biome-ignore lint/suspicious/noExplicitAny: <explanation>` pattern for legitimate any casts that remain (e.g., generic type manipulation)
- Error messages are lowercase imperative: `'Cannot initiate nested transaction'`, `'No callback'` — keep same style for injection error
- `export type` for type-only re-exports (per CLAUDE.md conventions)

### Integration Points
- `buildTypeParser()` feeds into `new Pool({ ...this.#config, types: buildTypeParser(...) })` in Database constructor
- `TransactionClient` calls `super(parentDb.config)` — the config object already carries `types` if the parent pool had it, so TransactionClient inherits correct parsers automatically
- SQL template type narrowing (D-08) affects the public `db.sql\`...\`` API surface — must not break existing call sites

</code_context>

<specifics>
## Specific Ideas

- Type parser override API: `new Database(url, { types: { INT8: (val) => BigInt(val) } })` — user overrides only what they want
- CTE chainable: `active.alias('active_subs').use(true)` for MATERIALIZED, `active.alias('s').use()` for plain AS
- SQL injection error must mention "SQL template parameter" to be findable in stack traces

</specifics>

<deferred>
## Deferred Ideas

- `configure()` as a named export that takes a `Database` instance and applies type parsers post-construction — out of scope, constructor option is the right approach
- `MATERIALIZED` / `NOT MATERIALIZED` as a separate `materialize()` method (Option A fluent builder) — deferred, user chose Option B (existing stubs)
- Partial index via column expressions (computed predicates beyond raw SQL string) — deferred, `where?: string` is sufficient for now

</deferred>

---

*Phase: 04-type-safety-and-security*
*Context gathered: 2026-03-23*
