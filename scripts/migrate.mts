// Apply migrations to the PostgreSQL database in DATABASE_URL: npm run db:migrate
// (The embedded local database migrates itself on first use.)
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing to migrate: the embedded database migrates itself.");
  process.exit(1);
}
const pool = new Pool({ connectionString: url });
await migrate(drizzle(pool), { migrationsFolder: join(process.cwd(), "drizzle") });
await pool.end();
console.log(`Migrations applied to ${new URL(url).host}.`);
