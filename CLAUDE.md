<!-- GSD:project-start source:PROJECT.md -->
## Project

**oopg**

A TypeScript-first PostgreSQL client library wrapping `node-pg` and its ecosystem. It provides type-safe schema definitions, SQL template literals, transaction management, streaming/cursor queries, and bulk operations — all with full TypeScript inference from column definitions. Intended for public release on npm.

**Core Value:** Type-safe, ergonomic PostgreSQL access in TypeScript — the schema defines the types, the API enforces them.

### Constraints

- **API compatibility**: Transaction callback signature must remain `(transaction: Database, { commit, rollback }) => ...` — internal refactor only
- **Runtime**: Node.js 18+ — no browser/edge constraints
- **Build**: Rslib (ESM output) + Biome (lint/format) — no changes to build tooling
- **Language**: All code, comments, JSDoc, README in English
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 - Core language for entire library
- JavaScript (ES2022) - Runtime target after compilation
- SQL - PostgreSQL database queries via string templates
## Runtime
- Node.js 18+ (as specified in `rslib.config.ts`)
- Browser compatible (exports ES module format)
- pnpm - Lockfile present (`pnpm-lock.yaml`)
## Frameworks
- None - This is a library, not a framework
- Rslib 0.20.0 - Rust-based JavaScript library builder configured in `rslib.config.ts`
- Rstest 0.9.0 - Test framework runner via `@rstest/adapter-rslib` (0.2.1)
- Biome 2.4.6 - Unified linting, formatting, and assist tool
## Key Dependencies
- pg 8.20.0 - PostgreSQL client library for Node.js
- pg-cursor 2.19.0 - Cursor support for batch operations
- pg-query-stream 4.14.0 - Stream query results without loading into memory
- pg-copy-streams 7.0.0 - COPY command support for bulk operations
- through 2.3.8 - Stream utility library for piping
- eventemitter3 5.0.4 - EventEmitter implementation for listener subscriptions
- ts-toolbelt 9.6.0 - TypeScript type utilities for advanced type manipulation
- @lalex/console 2.0.0-rc.1 - Logging with scoped output for debug statements
- @types/node 24 - Node.js type definitions
## Configuration
- Environment variable: `OOPG_SHOW_SQL` - Set to `'true'` to enable SQL debug logging
- Connection string or `ClientConfig` object from pg library
- Accepts PostgreSQL connection strings (e.g., `postgresql://user:pass@host/db`)
- Supports `PoolConfig` for connection pooling customization
- TypeScript: `tsconfig.json` configured with:
## Platform Requirements
- Node.js 18+
- pnpm package manager
- TypeScript 5.9.3
- Node.js 18+
- PostgreSQL database (9.5+)
- No external API calls or third-party services required
- Can run in any Node.js environment with database access
## Scripts
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Lowercase with no separators (e.g., `database.ts`, `query.ts`, `types.ts`)
- Module exports organized logically by domain: `api.ts`, `const.ts`, `database.ts`, `query.ts`, `sql.ts`, `tables.ts`, `types.ts`, `utils.ts`
- Test files: `[module].test.ts` (e.g., `tests/index.test.ts`)
- camelCase for all function names
- Exported functions declared explicitly with `export function` or `export const` with arrow functions
- Type-safe overloading using multiple `export function` declarations (see `chunk()`, `step()`, `clientQuery()` in `src/query.ts` and `src/utils.ts`)
- Helper functions (internal) follow camelCase without export decorator
- camelCase for mutable variables: `let rows`, `let position`
- UPPERCASE_SNAKE_CASE for constants: `DEFAULT_POSTGRES_SCHEMA`, `DEFAULT_POSTGRES_PORT` (in `src/const.ts`)
- Single letter variables in type contexts only: `R extends Row = Row`, `T extends Row = Row`
- Logger instances use consistent scoping: `const LL = L.scope('module/submodule')` (see `src/tables.ts`, `src/query.ts`, `src/database.ts`)
- PascalCase for all type names: `RowWithId`, `EntityDescription`, `ColumnDefinition`, `PGType`
- Generic type parameters: Single uppercase letters (`T`, `R`, `DB`, `V`, `O`, `S`)
- Type interfaces use `export interface` for named contracts
- Type aliases use `export type` for mapped types and unions
- Test type names: Descriptive full names with suffix (e.g., `InputType`, `OutputType`, `AutoColumns`)
- Function options suffix with `Options`: `SelectOptions`, `ExecuteOptions`, `CursorOptions`, `StreamOptions`
- Function callback types suffix with `Callback`: `ChunkCallback`, `StepCallback`
- PascalCase: `Database`, `API`
- Access modifiers: `protected` for internal methods/properties, `private` for truly private (rare)
- Static properties for class-level constants: `protected static MEMO_TABLENAME_PREFIX` (in `src/database.ts`)
- Scope-specific logger: `const LL = L.scope('oopg/database')` pattern in files that use logging
- Biome-ignore suppressions use comment block format: `// biome-ignore lint/suspicious/noExplicitAny: <explanation>`
## Code Style
- Tool: Biome (`@biomejs/biome` v2.4.6)
- Indentation: Space (default 2 spaces per Biome)
- Quote style: Single quotes (`'string'`)
- Line endings: Implicit per Biome configuration
- Tool: Biome
- Enabled rules: `recommended` preset enabled
- Config file: `biome.json` with rule suppressions for legitimate cases
- Common suppressions: `noExplicitAny`, `noAsyncPromiseExecutor`, `noAssignInExpressions`, `noShadowRestrictedNames`, `noRedeclare`
- Suppressions are justified with `<explanation>` comments
- ES2022 lib target
- ESNext module resolution
- `strict: true` enabled (strictest type checking)
- `noEmit: true` (compilation only, no code generation)
- `isolatedModules: true` (each file compiles independently)
- Path aliases: None configured (relative imports used throughout)
## Import Organization
- Not used; all imports are relative paths (`./filename` or `../path/filename`)
- Aliases not needed due to flat module structure
- Named imports for specific exports: `import { select, execute, cursor } from './query'`
- Type imports use `import type { Type }` for type-only imports
- Namespace imports rare but used when needed: `import * as utils from './src/utils'` (in `index.ts`)
## Error Handling
- Throw `Error` with descriptive messages: `throw new Error('Transaction already commited or rolled back')`
- Error messages are lowercase imperative: 'No callback', 'Bad column definition format'
- Errors propagate naturally through async functions (no automatic wrapping)
- Try-catch blocks used in query functions for debug logging: `try { clientQuery(...) } catch (e) { L.error(...) }`
- Validation errors throw immediately: `if (!callback) throw new Error('No callback')`
- Debug logs: `L.debug('[SQL]', sql, values)` for query debugging
- Error logs: `L.error(sqlOrSubmittable)` when query throws
- Scope-based loggers: Each module gets `const LL = L.scope('module/area')` for context
- Missing required callbacks: `if (!callback) throw new Error('No callback')` (in `src/query.ts` line 128, `src/database.ts` line 560)
- Transaction state violations: Thrown with descriptive messages
- Invalid column/table definitions: Throw immediately with message
- Connection string parsing errors: Caught and re-thrown (in `src/utils.ts` lines 162-167)
## Logging
- Module scoping: `const LL = L.scope('oopg/component')` at top of file
- Debug level for detailed output: `LL.debug('message', data)`
- Error level for exceptions: `L.error('message')`
- Environment-driven behavior: `if (options?.debug || process.env.OOPG_SHOW_SQL === 'true')` enables SQL output
- Tags in debug output: `L.debug('[SQL]', sql, values)`, `L.debug('[CURSOR]', sql, values)`, `L.debug('[STREAM]', sql, values)`
## Comments
- Complex type logic: Type definition comments explain constraint logic
- Non-obvious business logic: Connection string parsing has inline comments explaining special cases
- Disabled code: Uses `// ` for commented-out sections, often with reason
- Biome suppressions: Every `// biome-ignore` includes `<explanation>` for future maintainers
- Not widely used; type signatures are self-documenting
- Function purpose implicit from name and signature
- Complex type aliases have inline comments: `// TODO: Plan for more control on partial indexes` (in `src/types.ts`)
- Rare, only on exported interfaces and types that need clarification
- Export declarations with complex generics stand alone without additional documentation
## Function Design
- Typed explicitly with union types where needed
- Options objects preferred for multiple optional parameters: `options?: SelectOptions`
- Overloaded signatures for flexible parameter handling (see `clientQuery`, `chunk`, `step`)
- Generic constraints widely used: `<R extends Row = Row>`, `<DB extends Database>`
- Typed explicitly: `Promise<QueryResult<T>>`, `Promise<R[]>`
- Overloaded functions have separate return type per signature
- Tuple returns rare (options objects preferred)
- Async functions return Promises
- Pattern: Declaration without body, then implementation with union/conditional logic
- Used for flexible APIs that accept values or options as single parameter
- Example in `src/query.ts`: `chunk()` has 3 overloads for different parameter combinations
- Implementation uses switch/typeof checks to disambiguate
## Module Design
- All exports are explicit `export` decorators (no default exports)
- Files export multiple related functions and types
- Pattern: Types exported first, then functions, then re-exports
- Barrel export in `index.ts`: Exports public API from all modules
- Used at root: `index.ts` re-exports `./src/api`, `./src/const`, `./src/database`, etc.
- Enables clean public API: `import { squared } from 'oopg'`
- Single barrel file (no nested barrel files)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Object-oriented wrapper around `pg` library with strong TypeScript support
- Schema-driven architecture where table/view definitions drive type inference
- Layered query execution from high-level operations to low-level SQL templates
- Event-based notification system using PostgreSQL's LISTEN/NOTIFY
- Streaming and cursor support for large result sets
## Layers
- Purpose: Define database schema structure and infer JavaScript types from PostgreSQL types
- Location: `src/types.ts`
- Contains: PostgreSQL type definitions (`PGType`), column definition types, input/output type inference helpers
- Depends on: TypeScript compiler (compile-time only)
- Used by: All other layers for type safety
- Purpose: Manage database connections, schema definitions, and transaction execution
- Location: `src/database.ts`
- Contains: `Database` class, schema builders, entity interfaces (`Table`, `View`, `MaterializedView`, `Func`)
- Depends on: `pg` library, `types.ts`, `query.ts`, `tables.ts`, `sql.ts`
- Used by: Application code to instantiate and interact with database
- Purpose: Create tables, manage indexes, handle bulk operations, and alter schemas
- Location: `src/tables.ts`
- Contains: `createTable()`, `createIndexes()`, `alterColumn()`, `insertIntoTable()`, `bulkWrite()`, `tableOutput()` functions
- Depends on: `types.ts`, `utils.ts`, `pg-copy-streams` for bulk operations
- Used by: `Database` class methods, high-level table management
- Purpose: Execute SQL queries in multiple modes (select, stream, cursor, batch processing)
- Location: `src/query.ts`
- Contains: `select()`, `execute()`, `stream()`, `cursor()`, `chunk()`, `step()`, `first()` functions
- Depends on: `pg`, `pg-query-stream`, `pg-cursor`, type definitions
- Used by: `Database` class, custom query contexts
- Purpose: Build type-safe SQL queries using template strings with automatic escaping and table/view references
- Location: `src/sql.ts`
- Contains: `createSQLContext()` function that generates `SQLTemplate` functions and table accessors
- Depends on: `database.ts`, `types.ts`, `ts-toolbelt` for advanced type operations
- Used by: Direct SQL queries in `Database.sql()` method
- Purpose: Provide abstract base class for building domain-specific API layers on top of the database
- Location: `src/api.ts`
- Contains: `API<DB>` abstract class for creating repository/service patterns
- Depends on: `database.ts`
- Used by: Application-specific API classes extending this base
- Purpose: Helper functions for SQL generation, value formatting, entity management
- Location: `src/utils.ts`
- Contains: `valueToSQL()`, `columnDefinitionToSQL()`, `formatEntity()`, `clientQuery()`, `parseConnectionString()`
- Depends on: `pg`, `types.ts`
- Used by: Query layer, tables layer, all SQL construction
## Data Flow
- Connection state: Managed by `pg.Pool` with configurable idle timeout
- Schema definitions: Stored in memory on Database instance via `SCHEMA_PROPERTY` symbol
- Transaction state: Implicit in connection isolation level and explicit transaction blocks
- Event listeners: Tracked in `eventEmitter` and lazy-initialized listener connection
## Key Abstractions
- Purpose: Central point for all database operations - connection pooling, schema management, query execution
- Examples: `src/database.ts` lines 85+
- Pattern: Proxy pattern (implements EventEmitter interface), Facade pattern (hides complexity of pool management)
- Methods: `connect()`, `query()`, `sql()`, `transaction()`, `table()`, `view()`, `func()`, all event methods
- Purpose: Define database entities and their row types with input/output type inference
- Examples: `src/database.ts` lines 1012+ (`Table`), 1041+ (`View`), 1057+ (`Func`)
- Pattern: Marker interfaces that extend `DatabaseEntity<T>` to enable schema type inference
- Purpose: Map PostgreSQL column types to JavaScript types (`JSType`), aggregate to row types (`OutputType`, `InputType`)
- Examples: `src/types.ts` lines 46-177
- Pattern: Conditional types (TypeScript feature) enabling zero-runtime overhead type safety
- Purpose: Type-safe SQL query building with automatic parameter escaping
- Examples: `src/sql.ts` lines 27-30
- Pattern: Template literal handler with closure over database schema
- Use: `const {rows} = await db.sql\`SELECT * FROM $\{db.users\} WHERE id = $\{userId\}\``
- Purpose: Declarative schema for table columns with validation, constraints, defaults
- Examples: `src/types.ts` lines 109-123
- Pattern: Tagged union type enabling discriminated unions for different column constraint types
## Entry Points
- Location: `index.ts`
- Triggers: NPM import of package
- Responsibilities: Re-exports public API from all layers
- Location: `src/database.ts:99-154`
- Triggers: Application instantiation `new Database(connectionString)`
- Responsibilities: Parse connection string, initialize connection pool, set up event listeners
- Location: `src/database.ts` (static `schema()` method pattern)
- Triggers: Defining application schema early in setup
- Responsibilities: Build typed table/view references, validate schema structure
- Location: `src/database.ts` query methods (`sql()`, `query.select()`, `transaction()`)
- Triggers: CRUD operations in application code
- Responsibilities: Prepare and execute SQL, handle transactions, return typed results
## Error Handling
- `clientQuery()` in `src/utils.ts` wraps pg queries and logs debug info before throwing
- Database pool errors logged but not caught (consumer responsibility)
- Type errors caught at compile time via TypeScript strict mode
- Validation errors in schema definitions caught at runtime in builder functions
## Cross-Cutting Concerns
- `src/database.ts`: `L.scope('oopg/database')`
- `src/query.ts`: `L.scope('oopg/query')`
- `src/tables.ts`: `L.scope('oopg/tables')`
- `src/sql.ts`: `L.scope('sql')`
- Debug output controlled by `options?.debug` parameter and `OOPG_SHOW_SQL` env var
- Column definition builders check for required fields
- Foreign key definitions validate entity references
- Table operation functions check for valid column names
- No dedicated validation framework (relies on type system)
- Username/password via connection URI
- SSL/TLS via connection config options
- No application-level auth abstraction
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
