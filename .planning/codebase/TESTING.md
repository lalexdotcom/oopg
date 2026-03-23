# Testing Patterns

**Analysis Date:** 2026-03-23

## Test Framework

**Runner:**
- `@rstest/core` v0.9.0 (Rust-based test runner for TypeScript)
- Config: `rstest.config.ts` with `@rstest/adapter-rslib` integration
- Builds with `@rslib/core` v0.20.0

**Assertion Library:**
- `@rstest/core` assertions (`.toBe()`, `.expect()`)

**Run Commands:**
```bash
npm test                # Run all tests once
npm run test:watch     # Run tests in watch mode
npm run build          # Build project before test
```

**Test Configuration:**
```typescript
// rstest.config.ts
import { withRslibConfig } from '@rstest/adapter-rslib';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: withRslibConfig(),
});
```

## Test File Organization

**Location:**
- Co-located in `tests/` directory at project root
- Pattern: `tests/[module].test.ts`

**Naming:**
- Files: `[module].test.ts` (e.g., `tests/index.test.ts`)
- Test cases: Lowercase descriptive strings

**Structure:**
```
tests/
├── index.test.ts        # Entry point tests
```

## Test Structure

**Suite Organization:**
```typescript
import { expect, test } from '@rstest/core';
import { squared } from '../src/index';

test('squared', () => {
  expect(squared(2)).toBe(4);
  expect(squared(12)).toBe(144);
});
```

**Patterns:**
- Each test is a simple `test(name, () => { ... })` function
- No nested describe blocks (flat structure)
- Single test case per test function
- Direct assertion without setup/teardown (inline simple tests)
- Import functions from source under test using relative paths

**Assertion Pattern:**
- Method chaining: `.expect(value).toBe(expected)`
- Simple equality checks for basic values
- No complex matchers (only `.toBe()` observed)

## Mocking

**Framework:** Not detected in codebase

**Approach:**
- No mocking library configured
- Tests appear to use real implementations (database calls would be actual queries)
- No mock fixtures or factory functions observed
- Direct function testing without dependency injection

**What NOT to Mock:**
- Currently unused; tests call real functions directly
- If mocking becomes needed, consider `vitest` with `vi.mock()` or similar

## Fixtures and Test Data

**Test Data:**
- Inline values in test functions
- No separate fixture files
- Simple hardcoded test values: `expect(squared(2)).toBe(4)`, `expect(squared(12)).toBe(144)`

**Location:**
- Tests directory: `tests/`
- Data defined within each test file

## Coverage

**Requirements:**
- No coverage enforcement configured
- No coverage reporting tools in devDependencies

**Current Status:**
- Limited test suite (only `tests/index.test.ts` present)
- Single test file covering one function

## Test Types

**Unit Tests:**
- Primary test type observed
- Scope: Individual functions (`squared()` function tested)
- Approach: Direct function calls with assertions
- Database/query functions would require actual database connection (if tested)

**Integration Tests:**
- Not observed in codebase
- Would require database fixtures if added

**E2E Tests:**
- Not used

## Common Patterns

**Basic Test:**
```typescript
test('descriptive name', () => {
  expect(functionUnderTest(input)).toBe(expectedOutput);
  expect(functionUnderTest(anotherInput)).toBe(anotherExpectedOutput);
});
```

**Multiple Assertions:**
- Each `.expect()` is independent
- All assertions run even if earlier ones fail
- Use multiple expect calls for different test cases in same test

**Async Testing:**
- Not observed in current tests
- If needed, test function can be async: `test('name', async () => { ... })`
- Would use `await` on promises within test function

**Error Testing:**
- Not observed in current tests
- Pattern would be: `expect(() => throwingFunction()).toThrow()` (if available in @rstest)
- Current assertion library focused on value equality

## Test Patterns to Follow

When writing new tests for this codebase:

**For Database Functions (`src/database.ts`):**
- Would need database fixture or connection string
- Test transaction handling separately from query execution
- Mock or stub client operations if testing database class

**For Query Functions (`src/query.ts`):**
- Test SQL generation logic separately if possible
- Would require mock `ClientBase` instance for async tests

**For Type System (`src/types.ts`):**
- Primarily compile-time type checking (TypeScript)
- Runtime tests verify type helper functions like `varchar()`, `date()`, `required()`
- Example test pattern:
```typescript
test('varchar type definition', () => {
  const def = varchar(255);
  expect(def.type).toBe('varchar');
  expect(def.precision).toBe(255);
});
```

**For Utilities (`src/utils.ts`):**
- Test SQL formatting and escaping functions
- Example:
```typescript
test('valueToSQL converts string', () => {
  expect(valueToSQL('hello')).toBe("'hello'");
  expect(valueToSQL(123)).toBe('123');
  expect(valueToSQL(null)).toBe('NULL');
});
```

---

*Testing analysis: 2026-03-23*
