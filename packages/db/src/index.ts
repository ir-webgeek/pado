import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, {
    max: opts.max ?? 20,
    idle_timeout: 30,
    // prepared statements are faster; disable when running behind pgbouncer in transaction mode
    prepare: process.env.PG_PREPARE !== "false",
  });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}
