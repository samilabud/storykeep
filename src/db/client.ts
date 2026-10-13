import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }
  // Hosted Postgres URLs often say "sslmode=require". The pg driver treats
  // that as full certificate verification today and warns that this will
  // change. Asking for "verify-full" by name keeps today's (strict)
  // behaviour and keeps the logs clean.
  const url = connectionString.replace(
    /sslmode=(require|prefer|verify-ca)\b/,
    "sslmode=verify-full",
  );
  // A serverless host runs many small copies of the app. Keep each copy's
  // pool small so together they do not use up the database's connections.
  const pool = new Pool({ connectionString: url, max: process.env.VERCEL ? 3 : 10 });
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
