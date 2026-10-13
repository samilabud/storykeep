import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3100" },
  // Starts the app if it is not already running. Needs `docker compose up -d`
  // and `pnpm db:migrate` first.
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3100",
    reuseExistingServer: true,
  },
});
