# Codebase Structure

**Analysis Date:** 2026-03-23

## Directory Layout

```
oopg/
├── src/                    # TypeScript source code
│   ├── api.ts             # Abstract API base class for domain layer
│   ├── const.ts           # Constants (PostgreSQL defaults)
│   ├── database.ts        # Database class, schema management, entity definitions
│   ├── query.ts           # Query execution functions (select, stream, cursor, etc.)
│   ├── sql.ts             # Type-safe SQL template context builder
│   ├── tables.ts          # Table operations (create, index, bulk, insert, etc.)
│   ├── types.ts           # PostgreSQL/JavaScript type mappings and inference
│   └── utils.ts           # SQL formatting, value escaping, query helpers
├── tests/                 # Test files
│   └── index.test.ts      # Basic test suite
├── index.ts               # Module entry point and re-exports
├── package.json           # Dependencies and build scripts
├── tsconfig.json          # TypeScript configuration
├── biome.json             # Biome linter/formatter config
├── rslib.config.ts        # Rslib build configuration
├── rstest.config.ts       # Rstest test runner configuration
└── README.md              # Project documentation
```

## Directory Purposes

**src/ - Source Code:**
- Purpose: All TypeScript implementation files
- Contains: Type definitions, classes, functions for database operations
- Key files: `database.ts` (main entry point via Database class), `types.ts` (type system)

**tests/ - Test Files:**
- Purpose: Test specifications and test utilities
- Contains: Unit and integration tests using rstest framework
- Key files: `index.test.ts` (currently minimal test coverage)

**Root - Configuration & Entry:**
- Purpose: Project metadata, build/test configuration, module exports
- Contains: package.json, TypeScript config, build tool configs

## Key File Locations

**Entry Points:**
- `index.ts`: Module entry point - re-exports public API from all src/ modules
- `src/database.ts`: Main Database class constructor, schema builder interface

**Configuration:**
- `tsconfig.json`: TypeScript compile options (ES2022 target, strict mode, module resolution)
- `package.json`: Dependencies (pg, pg-cursor, pg-query-stream, pg-copy-streams), build/test scripts
- `biome.json`: Code formatting and linting rules

**Core Logic:**
- `src/database.ts` (1300+ lines): Database class, connection pooling, event management, query methods
- `src/types.ts` (220+ lines): Complete PostgreSQL-to-JavaScript type mapping system
- `src/tables.ts` (900+ lines): Schema operations, bulk writes, index management
- `src/query.ts` (230+ lines): Query execution modes (select, stream, cursor, step)
- `src/sql.ts` (600+ lines): SQL template builder with table/view accessors
- `src/utils.ts` (250+ lines): SQL generation helpers, value escaping, connection parsing

**Testing:**
- `tests/index.test.ts`: Test entry point (currently contains placeholder test for `squared()` function)
- `rstest.config.ts`: Test runner configuration

## Naming Conventions

**Files:**
- kebab-case not used; all files are lowercase single-word or compound: `database.ts`, `query.ts`, `api.ts`
- Pattern: Match exported class/function name: `database.ts` exports `Database`, `api.ts` exports `API`
- No file extension conventions: TypeScript modules use `.ts` extension

**Directories:**
- Flat structure preferred: No nested src/domain, src/utils pattern
- Single-word names: `src/`, `tests/`
- Following Node.js conventions: `tests/` not `spec/` or `__tests__/`

**Functions:**
- camelCase: `select()`, `createTable()`, `clientQuery()`, `formatEntity()`
- Compound verbs for actions: `createTable()`, `insertIntoTable()`, `tableExists()`
- Factory/builder functions: `createSQLContext()`, `createTableObjectStream()`

**Variables:**
- camelCase for all variables and parameters: `columns`, `rowMode`, `batchSize`
- Private fields use hash prefix: `#config`, `#acquired` in Database class
- Symbols for internal markers: `SCHEMA_PROPERTY` for schema validation

**Types:**
- PascalCase: `Database`, `Table`, `View`, `API`, `Row`, `EntityDescription`
- Discriminated unions: `ColumnDefinition`, `IndexDefinition`, `ForeignKeyDefinition`
- Type utility suffixes: `InputType<>`, `OutputType<>`, `JSType<>`, `ColumnToType<>`
- Prefixed types: `PGType`, `PGIDType`, `PGTextType`, `PGNumericType`, `PGDateType`, `PGObjectType`, `PGBooleanType`

## Where to Add New Code

**New Feature:**
- Primary code: Add functions to appropriate `src/` module based on concern
  - Query execution: `src/query.ts`
  - Schema definition: `src/database.ts` or new interface in `src/types.ts`
  - Table operations: `src/tables.ts`
  - Custom SQL: Extend `src/sql.ts` template system
- Tests: `tests/[feature].test.ts` co-located with test file for feature
- Exports: Add to `index.ts` if public API

**New Table/Entity Management Function:**
- Implementation: `src/tables.ts` following existing patterns (async function with `client: ClientBase` parameter, `options?: OperationOptions`)
- Types: Add option types as exported type aliases in same file (e.g., `CreateTableOptions`, `AlterColumnOptions`)
- Use: Call via `database.ts` methods that use the function internally or expose via builder

**New Query Execution Mode:**
- Implementation: `src/query.ts` with signature following `select()`, `stream()`, `cursor()` patterns
- Override: `getValuesAndOptions()` utility to parse mixed parameters
- Types: Create `[Mode]Options` type extending `OperationOptions`

**Utilities:**
- Shared helpers: `src/utils.ts` for SQL generation, value formatting, entity management
- Internal functions: Marked as helper functions, not typically exported in index.ts
- Export: Only if needed by consumers (most utils are internal)

**Type Utilities:**
- Column/type mapping: `src/types.ts` for conditional types and helper types
- PostgreSQL types: Add to `PGType` discriminated union if adding new column types
- Inference helpers: Use TypeScript conditional types, prefer compile-time validation

**Tests:**
- Location: `tests/index.test.ts` or new test file per feature
- Framework: rstest (configured in `rstest.config.ts`)
- Import: Feature from `../src/[module]` or module exports from `../index.ts`

## Special Directories

**src - Not Generated:**
- Purpose: Hand-written source code
- Generated: No
- Committed: Yes

**tests - Not Generated:**
- Purpose: Test specifications and test utilities
- Generated: No
- Committed: Yes

**dist - Generated on Build:**
- Purpose: Compiled JavaScript output and type declaration files
- Generated: Yes (by `rslib build`)
- Committed: No (in .gitignore)

**node_modules - Dependencies:**
- Purpose: Installed package dependencies
- Generated: Yes (by pnpm install)
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-03-23*
