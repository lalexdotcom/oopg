# Coding Conventions

**Analysis Date:** 2026-03-23

## Naming Patterns

**Files:**
- Lowercase with no separators (e.g., `database.ts`, `query.ts`, `types.ts`)
- Module exports organized logically by domain: `api.ts`, `const.ts`, `database.ts`, `query.ts`, `sql.ts`, `tables.ts`, `types.ts`, `utils.ts`
- Test files: `[module].test.ts` (e.g., `tests/index.test.ts`)

**Functions:**
- camelCase for all function names
- Exported functions declared explicitly with `export function` or `export const` with arrow functions
- Type-safe overloading using multiple `export function` declarations (see `chunk()`, `step()`, `clientQuery()` in `src/query.ts` and `src/utils.ts`)
- Helper functions (internal) follow camelCase without export decorator

**Variables:**
- camelCase for mutable variables: `let rows`, `let position`
- UPPERCASE_SNAKE_CASE for constants: `DEFAULT_POSTGRES_SCHEMA`, `DEFAULT_POSTGRES_PORT` (in `src/const.ts`)
- Single letter variables in type contexts only: `R extends Row = Row`, `T extends Row = Row`
- Logger instances use consistent scoping: `const LL = L.scope('module/submodule')` (see `src/tables.ts`, `src/query.ts`, `src/database.ts`)

**Types:**
- PascalCase for all type names: `RowWithId`, `EntityDescription`, `ColumnDefinition`, `PGType`
- Generic type parameters: Single uppercase letters (`T`, `R`, `DB`, `V`, `O`, `S`)
- Type interfaces use `export interface` for named contracts
- Type aliases use `export type` for mapped types and unions
- Test type names: Descriptive full names with suffix (e.g., `InputType`, `OutputType`, `AutoColumns`)
- Function options suffix with `Options`: `SelectOptions`, `ExecuteOptions`, `CursorOptions`, `StreamOptions`
- Function callback types suffix with `Callback`: `ChunkCallback`, `StepCallback`

**Classes:**
- PascalCase: `Database`, `API`
- Access modifiers: `protected` for internal methods/properties, `private` for truly private (rare)
- Static properties for class-level constants: `protected static MEMO_TABLENAME_PREFIX` (in `src/database.ts`)

**Scope Variables:**
- Scope-specific logger: `const LL = L.scope('oopg/database')` pattern in files that use logging
- Biome-ignore suppressions use comment block format: `// biome-ignore lint/suspicious/noExplicitAny: <explanation>`

## Code Style

**Formatting:**
- Tool: Biome (`@biomejs/biome` v2.4.6)
- Indentation: Space (default 2 spaces per Biome)
- Quote style: Single quotes (`'string'`)
- Line endings: Implicit per Biome configuration

**Linting:**
- Tool: Biome
- Enabled rules: `recommended` preset enabled
- Config file: `biome.json` with rule suppressions for legitimate cases
- Common suppressions: `noExplicitAny`, `noAsyncPromiseExecutor`, `noAssignInExpressions`, `noShadowRestrictedNames`, `noRedeclare`
- Suppressions are justified with `<explanation>` comments

**TypeScript Compiler:**
- ES2022 lib target
- ESNext module resolution
- `strict: true` enabled (strictest type checking)
- `noEmit: true` (compilation only, no code generation)
- `isolatedModules: true` (each file compiles independently)
- Path aliases: None configured (relative imports used throughout)

## Import Organization

**Order (observed):**
1. Node.js built-in modules: `import { L } from '@lalex/console'`, `import { EOL } from 'node:os'`
2. External packages: `import pg from 'pg'`, `import EventEmitter from 'eventemitter3'`
3. Type imports: `import type { ClientBase } from 'pg'`
4. Local modules: `import { ... } from './const'`, `import { ... } from './utils'`
5. Type-only imports: `import type { Row } from './types'`

**Path Aliases:**
- Not used; all imports are relative paths (`./filename` or `../path/filename`)
- Aliases not needed due to flat module structure

**Import Destructuring:**
- Named imports for specific exports: `import { select, execute, cursor } from './query'`
- Type imports use `import type { Type }` for type-only imports
- Namespace imports rare but used when needed: `import * as utils from './src/utils'` (in `index.ts`)

## Error Handling

**Patterns:**
- Throw `Error` with descriptive messages: `throw new Error('Transaction already commited or rolled back')`
- Error messages are lowercase imperative: 'No callback', 'Bad column definition format'
- Errors propagate naturally through async functions (no automatic wrapping)
- Try-catch blocks used in query functions for debug logging: `try { clientQuery(...) } catch (e) { L.error(...) }`
- Validation errors throw immediately: `if (!callback) throw new Error('No callback')`

**Logging on error:**
- Debug logs: `L.debug('[SQL]', sql, values)` for query debugging
- Error logs: `L.error(sqlOrSubmittable)` when query throws
- Scope-based loggers: Each module gets `const LL = L.scope('module/area')` for context

**Common error conditions:**
- Missing required callbacks: `if (!callback) throw new Error('No callback')` (in `src/query.ts` line 128, `src/database.ts` line 560)
- Transaction state violations: Thrown with descriptive messages
- Invalid column/table definitions: Throw immediately with message
- Connection string parsing errors: Caught and re-thrown (in `src/utils.ts` lines 162-167)

## Logging

**Framework:** `@lalex/console` (imported as `L`)

**Patterns:**
- Module scoping: `const LL = L.scope('oopg/component')` at top of file
- Debug level for detailed output: `LL.debug('message', data)`
- Error level for exceptions: `L.error('message')`
- Environment-driven behavior: `if (options?.debug || process.env.OOPG_SHOW_SQL === 'true')` enables SQL output
- Tags in debug output: `L.debug('[SQL]', sql, values)`, `L.debug('[CURSOR]', sql, values)`, `L.debug('[STREAM]', sql, values)`

## Comments

**When to Comment:**
- Complex type logic: Type definition comments explain constraint logic
- Non-obvious business logic: Connection string parsing has inline comments explaining special cases
- Disabled code: Uses `// ` for commented-out sections, often with reason
- Biome suppressions: Every `// biome-ignore` includes `<explanation>` for future maintainers

**JSDoc/TSDoc:**
- Not widely used; type signatures are self-documenting
- Function purpose implicit from name and signature
- Complex type aliases have inline comments: `// TODO: Plan for more control on partial indexes` (in `src/types.ts`)

**Documentation Comments:**
- Rare, only on exported interfaces and types that need clarification
- Export declarations with complex generics stand alone without additional documentation

## Function Design

**Size:** Generally 20-100 lines, with larger functions handling complex multi-step operations

**Parameters:**
- Typed explicitly with union types where needed
- Options objects preferred for multiple optional parameters: `options?: SelectOptions`
- Overloaded signatures for flexible parameter handling (see `clientQuery`, `chunk`, `step`)
- Generic constraints widely used: `<R extends Row = Row>`, `<DB extends Database>`

**Return Values:**
- Typed explicitly: `Promise<QueryResult<T>>`, `Promise<R[]>`
- Overloaded functions have separate return type per signature
- Tuple returns rare (options objects preferred)
- Async functions return Promises

**Multiple Signatures (Overloading):**
- Pattern: Declaration without body, then implementation with union/conditional logic
- Used for flexible APIs that accept values or options as single parameter
- Example in `src/query.ts`: `chunk()` has 3 overloads for different parameter combinations
- Implementation uses switch/typeof checks to disambiguate

## Module Design

**Exports:**
- All exports are explicit `export` decorators (no default exports)
- Files export multiple related functions and types
- Pattern: Types exported first, then functions, then re-exports
- Barrel export in `index.ts`: Exports public API from all modules

**Barrel Files:**
- Used at root: `index.ts` re-exports `./src/api`, `./src/const`, `./src/database`, etc.
- Enables clean public API: `import { squared } from 'oopg'`
- Single barrel file (no nested barrel files)

**Typical Module Structure:**
```typescript
// 1. Imports (node, external, local)
import { L } from '@lalex/console';
import type { ClientBase } from 'pg';
import { ... } from './types';

// 2. Setup (loggers, constants)
const LL = L.scope('module');

// 3. Type definitions and interfaces
export type SelectOptions = ...;
export interface DatabaseElement { ... }

// 4. Utility functions
function internalHelper() { ... }

// 5. Exported functions
export function select<R extends Row>(...) { ... }
export function execute<R extends Row>(...) { ... }

// 6. Re-exports (if any)
export { something } from './other';
```

---

*Convention analysis: 2026-03-23*
