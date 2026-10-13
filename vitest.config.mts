import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.local", quiet: true });

// Tests always talk to the throwaway test database, never the dev one.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://storykeep:storykeep@localhost:5441/storykeep_test";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl },
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
