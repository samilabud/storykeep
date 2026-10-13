import { expect, test } from "@playwright/test";
import { query } from "./db";
import { createStory, register } from "./helpers";
import { payOnStripeCheckout, stripeForTests } from "./stripe";

// A real subscription in Stripe TEST MODE. Needs `pnpm stripe:listen`.
// Run with:  pnpm test:e2e:stripe
test.skip(!process.env.STRIPE_E2E, "needs Stripe test keys and `pnpm stripe:listen`");
test.setTimeout(180_000);

const run = Date.now();

test("subscription: subscribe on Stripe Checkout, open the portal, cancel", async ({ page }) => {
  const email = `hana-${run}@example.com`;
  await register(page, email);
  const main = page.locator("main:visible");
  const status = main.getByTestId("subscription-status");
  const access = main.getByTestId("subscription-access");

  // Before: a life story cannot get a draft.
  await createStory(page, "Aunt Rosa");
  const storyPath = new URL(page.url()).pathname;
  await main.getByRole("link", { name: "Start the questionnaire" }).click();
  await main.locator("#answer").fill("Rosa Maria Ortiz.");
  await main.getByRole("button", { name: "Save and continue" }).click();
  await expect(main.getByText("Question 2 of 9")).toBeVisible();
  await page.goto(storyPath);
  await expect(main.getByText("Life Story drafts are part of the $7/month subscription.")).toBeVisible();
  await page.screenshot({ path: "docs/evidence/m5-sub-1-locked.png", fullPage: true });

  // Subscribe.
  await main.getByRole("link", { name: "Subscribe to write drafts" }).click();
  await expect(status).toHaveText("none");
  await main.getByRole("button", { name: "Subscribe for $7/month" }).click();
  await payOnStripeCheckout(page);

  // Back in the app. "active" appears only when the webhooks have arrived.
  await page.waitForURL(/\/billing\?checkout=success/, { timeout: 60_000 });
  await expect(status).toHaveText("active", { timeout: 30_000 });
  await expect(access).toHaveText("yes");
  await expect(main.getByText("Your next payment is on")).toBeVisible();
  await page.screenshot({ path: "docs/evidence/m5-sub-2-active.png", fullPage: true });

  // Now the draft button is there.
  await page.goto(storyPath);
  await expect(main.getByRole("button", { name: "Write a draft from my answers" })).toBeVisible();

  // The Customer Portal opens on Stripe's side.
  await page.goto("/billing");
  await main.getByRole("button", { name: "Manage subscription" }).click();
  await page.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 });

  // Cancel through the Stripe API (the same thing the portal does at the end
  // of the period). The app learns it from the webhook.
  const [row] = await query<{ stripe_subscription_id: string }>(
    `select s.stripe_subscription_id from subscriptions s
     join users u on u.id = s.user_id where u.email = $1`,
    [email],
  );
  await stripeForTests().subscriptions.cancel(row.stripe_subscription_id);

  await page.goto("/billing");
  await expect(async () => {
    await page.reload();
    await expect(status).toHaveText("canceled", { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(access).toHaveText("no");
  await page.screenshot({ path: "docs/evidence/m5-sub-3-canceled.png", fullPage: true });

  await page.goto(storyPath);
  await expect(main.getByRole("button", { name: "Write a draft from my answers" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Go to billing" })).toBeVisible();
});
