# Codebase Concerns

**Analysis Date:** 2026-03-23

## Tech Debt

**Typo in debug output:**
- Issue: Misspelled command keyword 'delate' instead of 'delete'
- Files: `src/query.ts:40`
- Impact: Debug logs will never match the 'delete' command, preventing proper logging of DELETE operations when debugging
- Fix approach: Change string in array from 'delate' to 'delete'

**TODO: Partial index control not implemented:**
- Issue: Type definitions include TODO comments for partial index functionality that remains unimplemented
- Files: `src/types.ts:89`, `src/types.ts:96`
- Impact: Users cannot create partial indexes (indexes with WHERE clauses) through the type-safe API, despite the type system accommodating the syntax
- Fix approach: Implement runtime validation and SQL generation for partial index WHERE conditions

**TODO: Temporary table not set in non-debug mode:**
- Issue: Comment indicates bulk write operation may not properly handle temporary tables outside debug mode
- Files: `src/tables.ts:599`
- Impact: Potential data inconsistency or resource leaks if temp tables are treated as permanent in production
- Fix approach: Audit bulk write flow to ensure temporary tables are correctly marked and cleaned up regardless of debug flag

## Type Safety Issues

**Use of `any` type violations:**
- Issue: Multiple instances of `any` type casts bypass TypeScript's type safety
- Files: `src/database.ts:57`, `src/database.ts:680`, `src/database.ts:711`, `src/database.ts:732`, `src/database.ts:831`
- Impact: Constructor property access on Database subclasses may fail silently at runtime; type checking cannot catch errors
- Fix approach: Create a proper generic base class or protocol instead of using `(this.constructor as any)` casts

**SQL template complex conditional logic:**
- Issue: Nested conditional type definitions in `sql.ts` are extremely complex and difficult to maintain
- Files: `src/sql.ts:43-65`, `src/sql.ts:112-125`
- Impact: Hard to extend or debug type system; potential for type inference breakage with new features
- Fix approach: Refactor complex type unions into helper types with clearer names and comments

## Async Patterns & Error Handling

**Async Promise Executor pattern:**
- Issue: Use of `new Promise(async (res, rej) => {...})` in chunking operations
- Files: `src/query.ts:133`, `src/database.ts:426`
- Impact: Can cause unhandled promise rejections if errors occur before try-catch; harder to reason about error flow
- Fix approach: Use async IIFE or `.then()` chains instead of async promise executor

**Assignment in while condition:**
- Issue: Assignment expression `while ((rows = await curs.read(size)).length)` in loop
- Files: `src/query.ts:143`
- Impact: Reduces readability; makes it harder to debug state changes; requires biome linter suppression
- Fix approach: Extract row fetching into separate pre-loop call or use explicit while(true) with break condition

**Missing null checks before property access:**
- Issue: Some code paths don't validate client/callback arguments before use
- Files: `src/query.ts:128`, `src/database.ts:560` - throw 'No callback' but only after overloading resolution
- Impact: Type system doesn't guarantee callback exists at runtime in all code paths
- Fix approach: Use narrowing functions or assertion functions for callback validation

## Performance Bottlenecks

**Bulk type parser registration:**
- Issue: Global type parsers set once per module load in `src/query.ts:10-12`
- Files: `src/query.ts:10-12`
- Impact: INT8, INT4, NUMERIC parsing affects ALL pg client queries globally; cannot be customized per-query
- Fix approach: Move type parsers to per-query configuration or allow override via options

**String replacement in parameter renumbering:**
- Issue: Uses `.replaceAll(/\$(\d+)/gm, ...)` to renumber query parameters multiple times
- Files: `src/sql.ts:179-182`, `src/sql.ts:793-796`
- Impact: O(n) operation on SQL strings; can be slow with large nested queries
- Fix approach: Use a parameter map or offset tracking instead of string replacement

**EventEmitter listener setup synchronization:**
- Issue: Async event listener setup without proper synchronization
- Files: `src/database.ts:123-136`
- Impact: Race condition possible if LISTEN query executed twice before first completes; multiple connections created
- Fix approach: Use a lock/semaphore or promise-based single queue for listener initialization

## Fragile Areas

**Database proxy pattern complexity:**
- Issue: Multi-layered Proxy objects with handler chains make transactions and nested operations fragile
- Files: `src/database.ts:228-250`
- Impact: Difficult to extend; transaction semantics fragile to changes; hard to debug proxy interception
- Fix approach: Create explicit TransactionClient class instead of proxy manipulation

**CTE implementation incomplete:**
- Issue: CTE definition comments show incomplete/disabled functionality (alias, materialize methods)
- Files: `src/sql.ts:720-743`
- Impact: CTE feature partially implemented; users cannot rely on all advertised CTE operations
- Fix approach: Complete CTE implementation or remove disabled code and document limitations

**SQL parameter value handling switch statement:**
- Issue: Large switch statement in `sqlTaggedTemplate` with many type checks; catches `any` type in default clause
- Files: `src/sql.ts:164-213`
- Impact: Unknown types silently converted to strings; potential SQL injection vector if object type handling is incomplete
- Fix approach: Make default case throw error; explicitly handle all supported types

**Unvalidated column definitions:**
- Issue: Column type system is flexible but lacks runtime validation for invalid type combinations
- Files: `src/types.ts:109-123`
- Impact: User can define `{ type: 'varchar', scale: 10 }` which PostgreSQL doesn't support; creates invalid SQL
- Fix approach: Add runtime validation in `columnTypeToSQL()` or use stricter discriminated unions

## Test Coverage Gaps

**Minimal test suite:**
- Issue: Single test file with one test case for a `squared()` utility function
- Files: `tests/index.test.ts`
- Impact: Core functionality (database operations, transactions, SQL generation, type parsing) has zero test coverage
- Risk: High - regressions in query building, transaction handling, or type conversion won't be caught
- Priority: High - add integration tests for key operations

**No transaction rollback tests:**
- Issue: Transaction error handling path not tested
- Files: `src/database.ts:206-260`
- Impact: Silent failure scenarios in nested transactions or rollback failures could go undetected
- Priority: High

**No stress tests for connection pooling:**
- Issue: Concurrent client acquisition/release pattern not tested under load
- Files: `src/database.ts:87-121`
- Impact: Connection leaks or pool exhaustion under concurrent load not caught
- Priority: Medium

## Error Recovery Paths

**No error recovery in streaming operations:**
- Issue: If callback throws in chunk/step operations, cursor cleanup may fail
- Files: `src/query.ts:142-158`
- Impact: Cursor may remain open consuming database resources; connection may be blocked
- Fix approach: Add finally block or error handler wrapper around callback invocation

**Transaction commit/rollback state not idempotent:**
- Issue: Calling commit twice throws error; no way to safely check transaction state
- Files: `src/database.ts:217-226`
- Impact: Error handling code that retries might fail with "already committed" instead of original error
- Fix approach: Make commit/rollback idempotent or provide `getTransactionState()` method

## Security Considerations

**String escaping for identifiers:**
- Issue: Column field access uses string interpolation without proper escaping in some paths
- Files: `src/sql.ts:386`, `src/utils.ts:20`
- Impact: User can inject SQL in field/column aliases if using untrusted input
- Mitigation: Quoted identifiers used in most places; field access uses template literals with quotes
- Recommendation: Add explicit validation for identifier names and document escaping requirements

**Default parameter binding:**
- Issue: Numeric literals in SQL get typed as `::numeric` automatically
- Files: `src/sql.ts:198-199`
- Impact: May cause unexpected type coercion; large numbers lose precision when converted to float
- Recommendation: Document numeric type handling; consider requiring explicit type casting for edge cases

**Connection string parsing complexity:**
- Issue: Custom URI parser with special handling for spaces and dummy hosts
- Files: `src/utils.ts:144-243`
- Impact: Complex parsing logic with many branches; subtle bugs possible in edge cases
- Recommendation: Consider using `new URL()` or a dedicated parser library for connection strings

## Dependencies at Risk

**No explicit version constraints:**
- Issue: Package dependencies use `^` constraints allowing patch/minor updates
- Files: `package.json:26-45`
- Impact: `pg` driver updates (currently 8.20.0) could introduce breaking changes; `eventemitter3` upgrades could affect event behavior
- Recommendation: Pin to specific patch versions for production stability or add regression tests for driver updates

---

*Concerns audit: 2026-03-23*
