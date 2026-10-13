import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }
  // A serverless host runs many small copies of the app. Keep each copy's
  // pool small so together they do not use up the database's connections.
  const pool = new Pool({ connectionString, max: process.env.VERCEL ? 3 : 10 });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

// In dev, Next.js reloads modules on every change. Keeping the instance on
// globalThis stops each reload from opening a new connection pool.
const globalForDb = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  if (!globalForDb.__db) {
    globalForDb.__db = createDb();
  }
  return globalForDb.__db;
}
