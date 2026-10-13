import Stripe from "stripe";

let client: Stripe | undefined;

/**
 * The Stripe client. It refuses to start with anything but a test key, so
 * this project can never touch real money by accident.
 */
export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set in .env.local");
    if (!key.startsWith("sk_test_")) {
      throw new Error("STRIPE_SECRET_KEY must be a test key (sk_test_...)");
    }
    client = new Stripe(key);
  }
  return client;
}

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3100";
}

export const EULOGY_PRICE_CENTS = 900;
export const CURRENCY = "usd";
export const SUBSCRIPTION_PRICE_CENTS = 700;
