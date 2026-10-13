import type { ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { seedActiveSubscription } from "./db";
import { createStory, register } from "./helpers";
import { startMockWorker } from "./worker";

const run = Date.now();
let worker: ChildProcess;

// Start a real worker process with the mock model. The mock waits 2 seconds
// per draft, so there is time to close the page while the job runs.
test.beforeAll(async () => {
  worker = await startMockWorker(2000);
});

test.afterAll(() => {
  worker.kill("SIGTERM");
});

test("an AI draft is written in the background after the page is closed", async ({
  context,
}) => {
  const page = await context.newPage();
  await register(page, `finn-${run}@example.com`);
  // A life story needs a subscription. Billing has its own tests.
  await seedActiveSubscription(`finn-${run}@example.com`);
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
  await expect(laterMain.locator("ol li")).toHaveText([/Version 1.*AI draft · current/], {
    timeout: 20_000, // a cold dev server can be slow on the first load
  });
  // "Ada Lovelace Byron" comes from the answer. Checked loosely, so the test
  // also passes when a worker with the real model picked up the job.
  await expect(laterMain.getByLabel("Story text")).toHaveValue(/Ada Lovelace Byron/);
  await expect(laterMain.getByRole("button", { name: "Write a new draft" })).toBeVisible();
  await later.screenshot({ path: "docs/evidence/m3-draft-ready.png", fullPage: true });
});
