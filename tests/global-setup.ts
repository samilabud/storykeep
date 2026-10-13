import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Runs once before the whole test run: apply the real migrations to the
// test database. Tests then prove the same schema that dev and prod use.
export default async function setup() {
  config({ path: ".env.local", quiet: true });
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    "postgres://storykeep:storykeep@localhost:5441/storykeep_test";

  const pool = new Pool({ connectionString });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } catch (error) {
    throw new Error(
      "Could not reach the test database. Run `docker compose up -d` first.",
      { cause: error },
    );
  } finally {
    await pool.end();
  }
}
