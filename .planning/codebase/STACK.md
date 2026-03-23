# Technology Stack

**Analysis Date:** 2026-03-23

## Languages

**Primary:**
- TypeScript 5.9.3 - Core language for entire library
- JavaScript (ES2022) - Runtime target after compilation

**Secondary:**
- SQL - PostgreSQL database queries via string templates

## Runtime

**Environment:**
- Node.js 18+ (as specified in `rslib.config.ts`)
- Browser compatible (exports ES module format)

**Package Manager:**
- pnpm - Lockfile present (`pnpm-lock.yaml`)

## Frameworks

**Core:**
- None - This is a library, not a framework

**Build/Dev:**
- Rslib 0.20.0 - Rust-based JavaScript library builder configured in `rslib.config.ts`
  - Outputs ESM format with TypeScript declarations (.d.ts)
- Rstest 0.9.0 - Test framework runner via `@rstest/adapter-rslib` (0.2.1)

**Code Quality:**
- Biome 2.4.6 - Unified linting, formatting, and assist tool
  - Configuration: `biome.json`

## Key Dependencies

**Critical:**
- pg 8.20.0 - PostgreSQL client library for Node.js
  - Type definitions: `@types/pg` 8.20.0
  - Core to entire library's database connectivity

**PostgreSQL Utilities:**
- pg-cursor 2.19.0 - Cursor support for batch operations
  - Type definitions: `@types/pg-cursor` 2.7.2
- pg-query-stream 4.14.0 - Stream query results without loading into memory
- pg-copy-streams 7.0.0 - COPY command support for bulk operations
  - Type definitions: `@types/pg-copy-streams` 1.2.5

**Stream Processing:**
- through 2.3.8 - Stream utility library for piping
  - Type definitions: `@types/through` 0.0.33

**Event Handling:**
- eventemitter3 5.0.4 - EventEmitter implementation for listener subscriptions

**Development Utilities:**
- ts-toolbelt 9.6.0 - TypeScript type utilities for advanced type manipulation
- @lalex/console 2.0.0-rc.1 - Logging with scoped output for debug statements
- @types/node 24 - Node.js type definitions

## Configuration

**Environment:**
- Environment variable: `OOPG_SHOW_SQL` - Set to `'true'` to enable SQL debug logging
  - Used in `src/query.ts`, `src/utils.ts`, `src/tables.ts`
  - Overrides per-operation `debug` flag

**Connection:**
- Connection string or `ClientConfig` object from pg library
- Accepts PostgreSQL connection strings (e.g., `postgresql://user:pass@host/db`)
- Supports `PoolConfig` for connection pooling customization

**Build:**
- TypeScript: `tsconfig.json` configured with:
  - Target: ES2022
  - Module: ESNext (transformed by Rslib)
  - Strict mode enabled
  - Isolated modules
  - Bundler module resolution

## Platform Requirements

**Development:**
- Node.js 18+
- pnpm package manager
- TypeScript 5.9.3

**Production:**
- Node.js 18+
- PostgreSQL database (9.5+)
- No external API calls or third-party services required
- Can run in any Node.js environment with database access

## Scripts

```bash
npm run build      # Compile TypeScript to JavaScript (Rslib)
npm run dev        # Watch mode build
npm run check      # Lint with Biome
npm run format     # Format code with Biome
npm run test       # Run tests with Rstest
npm run test:watch # Watch mode tests
```

---

*Stack analysis: 2026-03-23*
