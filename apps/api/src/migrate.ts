// Production migration entry (bundled to dist/migrate.js). Development uses `pnpm db:migrate`.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: process.env.MIGRATIONS_DIR ?? "packages/db/drizzle" });
await client.end();
console.log("migrations applied");
