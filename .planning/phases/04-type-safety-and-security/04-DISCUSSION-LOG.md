# Phase 4: Type Safety and Security - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the reasoning.

**Date:** 2026-03-23
**Phase:** 04-type-safety-and-security
**Mode:** discuss
**Areas discussed:** Type parsers, configure() fate, CTE ergonomics, SQL injection guard

## Decisions Made

### Type Parsers
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where to apply parsers | Per-pool via Database constructor `types` option | No global mutation, two Database instances can have different parsers, compatible with `sideEffects: false` |
| configure() fate | Remove entirely | Added in Phase 3, immediately superseded by Phase 4. No users exist yet. |
| Default parser behavior | Keep oopg defaults (INT8/INT4→number, NUMERIC→float) unless overridden | Preserves existing behavior for users who don't pass `types` |
| Type re-export | Re-export `builtinsTypes` as `PGTypeName` from `src/types.ts` | Users shouldn't need to import from `pg-types` directly |

### CTE Ergonomics
| Option | Considered | Chosen |
|--------|-----------|--------|
| Fluent builder (chainable .alias().materialize()) | Yes | No |
| Implement existing stubs (Option B) | Yes | **Yes** |
| Minimal alias-only | Yes | No |

**Rationale for Option B:** The `SQLCTEDefinition<T>` interface already defines the right method signatures. Implementing the bodies is the minimal-effort path that doesn't require redesigning the public API.

### SQL Injection
- Throw at runtime in `default` case of `sqlTaggedTemplate`
- Also narrow TypeScript type (`SQLParam<T>` replacement)
- Error message must mention "SQL template parameter" and injection risk

### configure() background
During Phase 3, `configure()` was created as the mechanism to move `setTypeParser` calls out of module load time. During Phase 4 discussion (before planning), the user and Claude identified that this still causes a global side effect — `pg.types` is a process-wide registry. The proper solution is per-pool type parsers via `Pool({ types: customTypesConfig })` which `@types/pg` already supports. Phase 4 supersedes Phase 3's `configure()` entirely.

## Pre-Discussion Decisions (from conversation before /gsd:discuss-phase)
These were resolved in a design conversation before the formal discuss-phase workflow ran:
- D-01 through D-06: Type parser architecture (per-pool, no global mutation)
- These decisions were captured verbatim into CONTEXT.md
