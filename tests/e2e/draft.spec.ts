import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createStory, register } from "./helpers";

const run = Date.now();
let worker: ChildProcess;

// Start a real worker process with the mock model. The mock waits 2 seconds
// per draft, so there is time to close the page while the job runs.
test.beforeAll(async () => {
  worker = spawn("pnpm", ["worker"], {
    env: { ...process.env, LLM_PROVIDER: "mock", MOCK_LLM_DELAY_MS: "2000" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    worker.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("[worker] started")) resolve();
    });
    worker.on("exit", () => reject(new Error("worker exited before it started")));
  });
});

test.afterAll(() => {
  worker.kill("SIGTERM");
});

test("an AI draft is written in the background after the page is closed", async ({
  context,
}) => {
  const page = await context.newPage();
  await register(page, `finn-${run}@example.com`);
  await createStory(page, "Grandma Ada");
  const storyPath = new URL(page.url()).pathname;
  const main = page.locator("main:visible");

  // No answers yet: no draft button.
  await expect(main.getByText("Answer at least one question to get a draft.")).toBeVisible();

  await main.getByRole("link", { name: "Start the questionnaire" }).click();
  await main.locator("#answer").fill("Ada Lovelace Byron, called Ada.");
  await main.getByRole("button", { name: "Save and continue" }).click();
  await expect(main.getByText("Question 2 of 9")).toBeVisible();

  await page.goto(storyPath);
  await main.getByRole("button", { name: "Write a draft from my answers" }).click();
  await expect(main.getByRole("status")).toContainText("Writing your draft");
  await page.screenshot({ path: "docs/evidence/m3-draft-in-progress.png", fullPage: true });

  // Close the page while the job is still running. No browser tab is open now.
  await page.close();
  expect(context.pages()).toHaveLength(0);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Come back: the draft is already there.
  const later = await context.newPage();
  await later.goto(storyPath);
  const laterMain = later.locator("main:visible");
  await expect(laterMain.locator("ol li")).toHaveText([/Version 1.*AI draft · current/]);
  await expect(laterMain.getByLabel("Story text")).toHaveValue(/Ada Lovelace Byron, called Ada\./);
  await expect(laterMain.getByRole("button", { name: "Write a new draft" })).toBeVisible();
  await later.screenshot({ path: "docs/evidence/m3-draft-ready.png", fullPage: true });
});
