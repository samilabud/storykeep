import { defineConfig } from "@playwright/test";

// Set E2E_BASE_URL to run the "deployed" test against a live site.
const deployedUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: deployedUrl ?? "http://localhost:3100" },
  // Starts the app if it is not already running. Needs `docker compose up -d`
  // and `pnpm db:migrate` first. Not used against a deployed site.
  webServer: deployedUrl
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3100",
        reuseExistingServer: true,
      },
});
