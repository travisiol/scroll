import "server-only";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

/**
 * One Postgres, two ways to reach it:
 * - DATABASE_URL set → node-postgres pool. Run `npm run db:migrate`.
 * - otherwise → PGlite, an embedded Postgres stored under data/local/pg.
 *   Migrations are applied on first use.
 */
export type Db = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbInfo {
  driver: "postgres" | "pglite" | "memory";
  location: string;
}

interface Handle {
  db: Db;
  info: DbInfo;
  close: () => Promise<void>;
}

const g = globalThis as { __scrollDb?: Promise<Handle> };

/** data/local by default. SCROLL_DATA_DIR names another folder under data/ (the verification scripts use it to stay out of real data). */
export function dataDir(): string {
  const custom = process.env.SCROLL_DATA_DIR;
  return join(process.cwd(), "data", custom && /^[A-Za-z0-9_-]+$/.test(custom) ? custom : "local");
}

async function open(): Promise<Handle> {
  const migrationsFolder = join(process.cwd(), "drizzle");
  const url = process.env.DATABASE_URL;

  if (url && !process.env.SCROLL_DB_MEMORY) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema }) as unknown as Db;
    return { db, info: { driver: "postgres", location: new URL(url).host }, close: () => pool.end() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const memory = Boolean(process.env.SCROLL_DB_MEMORY);
  let location = "memory";
  let client: InstanceType<typeof PGlite>;
  if (memory) {
    client = new PGlite();
  } else {
    location = join(dataDir(), "pg");
    mkdirSync(location, { recursive: true });
    client = new PGlite(location);
  }
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, info: { driver: memory ? "memory" : "pglite", location }, close: () => client.close() };
}

async function handle(): Promise<Handle> {
  g.__scrollDb ??= open();
  try {
    return await g.__scrollDb;
  } catch (error) {
    g.__scrollDb = undefined;
    throw error;
  }
}

export async function getDb(): Promise<Db> {
  return (await handle()).db;
}

export async function dbInfo(): Promise<DbInfo> {
  return (await handle()).info;
}

export async function closeDb(): Promise<void> {
  if (!g.__scrollDb) return;
  const h = await g.__scrollDb;
  g.__scrollDb = undefined;
  await h.close();
}

export { schema };
