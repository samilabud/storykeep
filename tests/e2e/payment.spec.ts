import type { ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createStory, register } from "./helpers";
import { startMockWorker } from "./worker";

// This test pays on Stripe's real hosted Checkout page, in TEST MODE, with
// Stripe's test card. It needs `pnpm stripe:listen` running so the webhook
// reaches the app. Run it with:  pnpm test:e2e:stripe
test.skip(!process.env.STRIPE_E2E, "needs Stripe test keys and `pnpm stripe:listen`");
test.setTimeout(120_000);

const run = Date.now();
let worker: ChildProcess;

test.beforeAll(async () => {
  if (process.env.STRIPE_E2E) worker = await startMockWorker();
});
test.afterAll(() => {
  worker?.kill("SIGTERM");
});

test("one-time payment: pay $9 on Stripe Checkout, webhook unlocks one eulogy draft", async ({
  page,
}) => {
  await register(page, `gina-${run}@example.com`);
  await createStory(page, "Grandpa Joe", "Eulogy");
  const storyPath = new URL(page.url()).pathname;
  const main = page.locator("main:visible");

  await main.getByRole("link", { name: "Start the questionnaire" }).click();
  await main.locator("#answer").fill("Joseph Ellis, known as Joe.");
  await main.getByRole("button", { name: "Save and continue" }).click();
  await expect(main.getByText("Question 2 of 9")).toBeVisible();

  // Before payment: there is a pay button and no draft button.
  await page.goto(storyPath);
  await expect(main.getByRole("button", { name: "Write a draft from my answers" })).toHaveCount(0);
  await page.screenshot({ path: "docs/evidence/m4-1-before-payment.png", fullPage: true });
  await main.getByRole("button", { name: "Pay $9 with Stripe" }).click();

  // Stripe's hosted page. 4242 4242 4242 4242 is Stripe's "always succeeds" test card.
  await page.waitForURL(/checkout\.stripe\.com/);
  await expect(page.getByText("$9.00").first()).toBeVisible({ timeout: 30_000 });
  const cardOption = page.locator('[data-testid="card-accordion-item-button"]');
  if (await cardOption.count()) await cardOption.click();
  await page.locator("#cardNumber").fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Gina Test");
  const postalCode = page.locator("#billingPostalCode");
  if (await postalCode.isVisible()) await postalCode.fill("10001");
  // No screenshot here: Stripe's page renders as blank placeholders in a
  // headless screenshot.
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();

  // Back in the app. The unlock appears only once the webhook has arrived.
  await page.waitForURL(new RegExp(`${storyPath}\\?checkout=success`), { timeout: 60_000 });
  await expect(
    main.getByText("Payment received. Your eulogy draft is unlocked."),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "docs/evidence/m4-2-unlocked.png", fullPage: true });

  // Use the one paid generation.
  await main.getByRole("button", { name: "Write a draft from my answers" }).click();
  await expect(main.locator("ol li")).toHaveText([/Version 1.*AI draft · current/], {
    timeout: 30_000,
  });

  // It is used up: another draft needs another payment.
  await expect(main.getByText("Another draft is a new purchase.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Pay $9 with Stripe" })).toBeVisible();
  await page.screenshot({ path: "docs/evidence/m4-3-used.png", fullPage: true });
});
