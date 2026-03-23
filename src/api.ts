import type { Database } from './database';

/**
 * Options type for `API` subclass constructors. Merges a `db` property with
 * any additional custom options defined by the subclass.
 *
 * @example
 * ```ts
 * import type { APIOptions } from 'oopg';
 * import type { AppDB } from './db';
 *
 * type UserAPIOptions = APIOptions<AppDB, { defaultLimit?: number }>;
 * ```
 */
export type APIOptions<
  DB extends Database,
  T extends Record<string, unknown>,
> = T & {
  db?: DB;
};

/**
 * Abstract base class for building domain-specific API layers on top of a
 * `Database` instance. Subclass `API<DB>` to create typed repository or
 * service objects that share a single database connection.
 *
 * @example
 * ```ts
 * import { API, Database } from 'oopg';
 *
 * class UserAPI extends API<Database> {
 *   async findByEmail(email: string) {
 *     return this.db.first<{ id: string; email: string }>(
 *       'SELECT * FROM users WHERE email = $1',
 *       [email],
 *     );
 *   }
 * }
 *
 * const db = new Database(process.env.DATABASE_URL!);
 * const users = new UserAPI(db);
 * const user = await users.findByEmail('alice@example.com');
 * ```
 */
export abstract class API<DB extends Database> {
  protected db: DB;

  constructor(db: DB) {
    this.db = db;
  }
}
