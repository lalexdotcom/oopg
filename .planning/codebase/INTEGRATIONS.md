# External Integrations

**Analysis Date:** 2026-03-23

## APIs & External Services

**None detected** - This is a database library with no external API integrations. All operations are to PostgreSQL databases you control.

## Data Storage

**Databases:**
- PostgreSQL 9.5+
  - Connection: Configured via connection string or `ClientConfig` object in `Database` constructor
  - Client: Native `pg` package (PostgreSQL client for Node.js)
  - Pooling: Built-in connection pooling via `pg.Pool`
  - Configuration: `src/database.ts` Database class handles pool initialization and lifecycle

**File Storage:**
- Not applicable - Library is data access layer only

**Caching:**
- Memoization tables available via Database methods
  - Prefix: `__memo__` (defined in `src/database.ts`)
  - Optional parameter in select operations

## Authentication & Identity

**Auth Provider:**
- PostgreSQL native authentication
  - Username/password in connection string or `ClientConfig`
  - SSL/TLS support via `sslmode` connection parameter
  - No external identity provider needed

**Implementation:**
- Connection string parsing: `src/utils.ts` provides `parseConnectionString()` utility
- Connection parameters: `ClientConfig` from `pg` package supports:
  - `user`, `password`, `host`, `port`, `database`
  - `ssl` boolean or object for SSL configuration
  - `sslmode` for SSL connection modes

## Monitoring & Observability

**Error Tracking:**
- Not integrated - Library throws errors; applications handle logging

**Logs:**
- Console-based via `@lalex/console` library
- Debug flag: `debug?: boolean` option in operation methods
- Environment variable: `OOPG_SHOW_SQL='true'` enables all SQL logging
  - Checked in: `src/query.ts`, `src/utils.ts`, `src/tables.ts`
- Scoped logging prefix: `'oopg/database'` in database operations (`src/database.ts`)

**Event Listeners:**
- EventEmitter3 for database lifecycle events
- Pool events: `'acquire'`, `'release'` on connection lifecycle
- Available via `database.eventEmitter` property

## CI/CD & Deployment

**Hosting:**
- Not specified - This is a library for applications to use
- Applications using this library must:
  - Have network access to PostgreSQL server
  - Run on Node.js 18+

**CI Pipeline:**
- Not configured in repository - Applications will define their own CI

## Environment Configuration

**Required env vars:**
- None required - Connection passed explicitly to `Database` constructor

**Optional env vars:**
- `OOPG_SHOW_SQL` - Set to `'true'` to enable SQL query debugging
  - Useful for development and troubleshooting
  - Affects: cursor queries, stream queries, bulk operations

**Secrets location:**
- PostgreSQL credentials passed as constructor arguments (connection string or config object)
- Best practice: Use environment variables in your application to load credentials at runtime
- Example: `new Database(process.env.DATABASE_URL)`

## Webhooks & Callbacks

**Incoming:**
- Not applicable

**Outgoing:**
- Not applicable

## Connection Details

**Pool Configuration:**
The library initializes a PostgreSQL connection pool with options from:
1. `PoolConfig` parameter passed to Database constructor
2. Connection string or `ClientConfig` parameter (connection details)
3. Defaults in `pg` library

Available pool options:
- `max` - Maximum pool size
- `connectionTimeoutMillis` - Connection timeout
- `idleTimeoutMillis` - Idle connection timeout
- `reapIntervalMillis` - Pool reaping interval

**Example Usage:**
```typescript
import { Database } from 'oopg';

// From connection string
const db = new Database('postgresql://user:password@localhost/dbname');

// From config object
const db = new Database(
  { user: 'user', password: 'password', host: 'localhost', database: 'dbname' },
  { max: 20 } // pool config
);
```

---

*Integration audit: 2026-03-23*
