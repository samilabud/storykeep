import type { Page } from "@playwright/test";
import Stripe from "stripe";
import "./db"; // loads .env.local

/** A Stripe client for test setup. Refuses anything but a test key. */
export function stripeForTests(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) throw new Error("A Stripe TEST key is required");
  return new Stripe(key);
}

/** Fills Stripe's hosted Checkout page with a test card and submits it. */
export async function payOnStripeCheckout(page: Page, cardNumber = "4242 4242 4242 4242") {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  const cardOption = page.locator('[data-testid="card-accordion-item-button"]');
  await page.locator("#cardNumber, [data-testid='card-accordion-item-button']").first().waitFor({ timeout: 30_000 });
  if (await cardOption.count()) await cardOption.click();
  await page.locator("#cardNumber").fill(cardNumber);
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Test Customer");
  const postalCode = page.locator("#billingPostalCode");
  if (await postalCode.isVisible()) await postalCode.fill("10001");
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
}
