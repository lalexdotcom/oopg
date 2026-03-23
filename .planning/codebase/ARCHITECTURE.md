# Architecture

**Analysis Date:** 2026-03-23

## Pattern Overview

**Overall:** Type-safe PostgreSQL query builder and ORM abstraction layer

**Key Characteristics:**
- Object-oriented wrapper around `pg` library with strong TypeScript support
- Schema-driven architecture where table/view definitions drive type inference
- Layered query execution from high-level operations to low-level SQL templates
- Event-based notification system using PostgreSQL's LISTEN/NOTIFY
- Streaming and cursor support for large result sets

## Layers

**Type System Layer:**
- Purpose: Define database schema structure and infer JavaScript types from PostgreSQL types
- Location: `src/types.ts`
- Contains: PostgreSQL type definitions (`PGType`), column definition types, input/output type inference helpers
- Depends on: TypeScript compiler (compile-time only)
- Used by: All other layers for type safety

**Schema Definition & Database Layer:**
- Purpose: Manage database connections, schema definitions, and transaction execution
- Location: `src/database.ts`
- Contains: `Database` class, schema builders, entity interfaces (`Table`, `View`, `MaterializedView`, `Func`)
- Depends on: `pg` library, `types.ts`, `query.ts`, `tables.ts`, `sql.ts`
- Used by: Application code to instantiate and interact with database

**Table Operations Layer:**
- Purpose: Create tables, manage indexes, handle bulk operations, and alter schemas
- Location: `src/tables.ts`
- Contains: `createTable()`, `createIndexes()`, `alterColumn()`, `insertIntoTable()`, `bulkWrite()`, `tableOutput()` functions
- Depends on: `types.ts`, `utils.ts`, `pg-copy-streams` for bulk operations
- Used by: `Database` class methods, high-level table management

**Query Execution Layer:**
- Purpose: Execute SQL queries in multiple modes (select, stream, cursor, batch processing)
- Location: `src/query.ts`
- Contains: `select()`, `execute()`, `stream()`, `cursor()`, `chunk()`, `step()`, `first()` functions
- Depends on: `pg`, `pg-query-stream`, `pg-cursor`, type definitions
- Used by: `Database` class, custom query contexts

**SQL Template & Context Layer:**
- Purpose: Build type-safe SQL queries using template strings with automatic escaping and table/view references
- Location: `src/sql.ts`
- Contains: `createSQLContext()` function that generates `SQLTemplate` functions and table accessors
- Depends on: `database.ts`, `types.ts`, `ts-toolbelt` for advanced type operations
- Used by: Direct SQL queries in `Database.sql()` method

**API Base Class Layer:**
- Purpose: Provide abstract base class for building domain-specific API layers on top of the database
- Location: `src/api.ts`
- Contains: `API<DB>` abstract class for creating repository/service patterns
- Depends on: `database.ts`
- Used by: Application-specific API classes extending this base

**Utilities Layer:**
- Purpose: Helper functions for SQL generation, value formatting, entity management
- Location: `src/utils.ts`
- Contains: `valueToSQL()`, `columnDefinitionToSQL()`, `formatEntity()`, `clientQuery()`, `parseConnectionString()`
- Depends on: `pg`, `types.ts`
- Used by: Query layer, tables layer, all SQL construction

## Data Flow

**Schema Definition & Initialization:**

1. Developer defines schema using `Database.schema()` with table/view builders
2. Schema builder returns object with typed table/view references
3. Types are inferred from column definitions
4. Schema is stored internally in Database instance

**SELECT Query Flow:**

1. Application calls `db.sql\`SELECT ...\`` or `db.query.select(sql, values)`
2. Query execution layer receives SQL and values
3. `pg` library executes query with type parsers
4. Results are typed based on query context type parameters
5. Rows are returned as typed `Row` objects

**INSERT/UPDATE/DELETE Flow:**

1. Application calls table operation (`insertIntoTable()`, `bulkWrite()`, etc.)
2. Tables layer generates SQL from column definitions
3. `execute()` function runs the query and returns command metadata
4. Results are typed based on `OutputType` inferred from column definitions

**Streaming Flow:**

1. Application calls `db.query.stream(sql, values)` for large result sets
2. QueryStream reads rows in batches (configurable highWaterMark)
3. Rows flow through Node.js stream pipeline
4. Each row is parsed with type converters
5. Application consumes stream events

**Cursor-based Batch Processing:**

1. Application calls `db.query.chunk()` or `db.query.step()`
2. Cursor fetches batch of rows (configurable size)
3. Callback function processes batch
4. Cursor advances and repeats until exhausted

**Event-based Notifications:**

1. Database initializes LISTEN connection when event listeners added
2. Application calls `db.on('channel', handler)`
3. PostgreSQL NOTIFY triggers listener
4. EventEmitter broadcasts to all registered handlers
5. Automatic cleanup of LISTEN connection when last listener removed

**State Management:**

- Connection state: Managed by `pg.Pool` with configurable idle timeout
- Schema definitions: Stored in memory on Database instance via `SCHEMA_PROPERTY` symbol
- Transaction state: Implicit in connection isolation level and explicit transaction blocks
- Event listeners: Tracked in `eventEmitter` and lazy-initialized listener connection

## Key Abstractions

**Database Class:**
- Purpose: Central point for all database operations - connection pooling, schema management, query execution
- Examples: `src/database.ts` lines 85+
- Pattern: Proxy pattern (implements EventEmitter interface), Facade pattern (hides complexity of pool management)
- Methods: `connect()`, `query()`, `sql()`, `transaction()`, `table()`, `view()`, `func()`, all event methods

**Table/View/Function Interfaces:**
- Purpose: Define database entities and their row types with input/output type inference
- Examples: `src/database.ts` lines 1012+ (`Table`), 1041+ (`View`), 1057+ (`Func`)
- Pattern: Marker interfaces that extend `DatabaseEntity<T>` to enable schema type inference

**Type Inference System:**
- Purpose: Map PostgreSQL column types to JavaScript types (`JSType`), aggregate to row types (`OutputType`, `InputType`)
- Examples: `src/types.ts` lines 46-177
- Pattern: Conditional types (TypeScript feature) enabling zero-runtime overhead type safety

**SQLTemplate:**
- Purpose: Type-safe SQL query building with automatic parameter escaping
- Examples: `src/sql.ts` lines 27-30
- Pattern: Template literal handler with closure over database schema
- Use: `const {rows} = await db.sql\`SELECT * FROM $\{db.users\} WHERE id = $\{userId\}\``

**ColumnDefinition:**
- Purpose: Declarative schema for table columns with validation, constraints, defaults
- Examples: `src/types.ts` lines 109-123
- Pattern: Tagged union type enabling discriminated unions for different column constraint types

## Entry Points

**Module Exports:**
- Location: `index.ts`
- Triggers: NPM import of package
- Responsibilities: Re-exports public API from all layers

**Database Constructor:**
- Location: `src/database.ts:99-154`
- Triggers: Application instantiation `new Database(connectionString)`
- Responsibilities: Parse connection string, initialize connection pool, set up event listeners

**Schema Definition:**
- Location: `src/database.ts` (static `schema()` method pattern)
- Triggers: Defining application schema early in setup
- Responsibilities: Build typed table/view references, validate schema structure

**Query Execution:**
- Location: `src/database.ts` query methods (`sql()`, `query.select()`, `transaction()`)
- Triggers: CRUD operations in application code
- Responsibilities: Prepare and execute SQL, handle transactions, return typed results

## Error Handling

**Strategy:** Propagate pg library errors up the stack with additional context logging

**Patterns:**
- `clientQuery()` in `src/utils.ts` wraps pg queries and logs debug info before throwing
- Database pool errors logged but not caught (consumer responsibility)
- Type errors caught at compile time via TypeScript strict mode
- Validation errors in schema definitions caught at runtime in builder functions

Example error flow:
1. `select()` function calls `clientQuery()`
2. `pg` library throws on query error
3. Error propagates to caller with SQL/values logged if debug=true
4. Application handles or lets bubble to global error handler

## Cross-Cutting Concerns

**Logging:** Via `@lalex/console` library with scoped loggers per module:
- `src/database.ts`: `L.scope('oopg/database')`
- `src/query.ts`: `L.scope('oopg/query')`
- `src/tables.ts`: `L.scope('oopg/tables')`
- `src/sql.ts`: `L.scope('sql')`
- Debug output controlled by `options?.debug` parameter and `OOPG_SHOW_SQL` env var

**Validation:** Compile-time type validation via TypeScript strict mode. Runtime validation in:
- Column definition builders check for required fields
- Foreign key definitions validate entity references
- Table operation functions check for valid column names
- No dedicated validation framework (relies on type system)

**Authentication:** Delegated to PostgreSQL connection string parsing:
- Username/password via connection URI
- SSL/TLS via connection config options
- No application-level auth abstraction

---

*Architecture analysis: 2026-03-23*
