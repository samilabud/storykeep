import { expect, test } from "@playwright/test";
import { createStory, register } from "./helpers";
import { payOnStripeCheckout } from "./stripe";

// A smoke test for a DEPLOYED site (no local database, no local worker).
// It proves the parts that only exist in production: the hosted database,
// the Stripe webhook endpoint, and the job queue running without a worker.
// Stripe must be in test mode. Run with:
//   E2E_BASE_URL=https://your-site.vercel.app pnpm test:e2e:deployed
test.skip(!process.env.E2E_BASE_URL, "set E2E_BASE_URL to a deployed site");
test.setTimeout(180_000);

test("deployed: register, pay $9 in test mode, webhook unlocks, draft is written with no worker", async ({
  page,
}) => {
  await register(page, `smoke-${Date.now()}@example.com`);
  await createStory(page, "Smoke Test Eulogy", "Eulogy");
  const storyPath = new URL(page.url()).pathname;
  const main = page.locator("main:visible");

  await main.getByRole("link", { name: "Start the questionnaire" }).click();
  await main.locator("#answer").fill("Joseph Ellis, known as Joe.");
  await main.getByRole("button", { name: "Save and continue" }).click();
  await expect(main.getByText("Question 2 of 9")).toBeVisible();

  await page.goto(storyPath);
  await main.getByRole("button", { name: "Pay $9 with Stripe" }).click();
  await payOnStripeCheckout(page);

  // Stripe calls the deployed webhook. Only then does the page unlock.
  await page.waitForURL(new RegExp(`${storyPath}\\?checkout=success`), { timeout: 60_000 });
  await expect(
    main.getByText("Payment received. Your eulogy draft is unlocked."),
  ).toBeVisible({ timeout: 45_000 });

  // No worker process exists here. The app runs the job after the response.
  await main.getByRole("button", { name: "Write a draft from my answers" }).click();
  await expect(main.locator("ol li")).toHaveText([/Version 1.*AI draft · current/], {
    timeout: 90_000,
  });
  await expect(main.getByLabel("Story text")).toHaveValue(/Joe/);
  await page.screenshot({ path: "docs/evidence/deployed-smoke.png", fullPage: true });
});
