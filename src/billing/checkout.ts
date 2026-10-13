import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { orders, users } from "@/db/schema";
import { getStoryForUser } from "@/stories/data";
import { getEulogyPayment } from "./orders";
import {
  appUrl,
  CURRENCY,
  EULOGY_PRICE_CENTS,
  getStripe,
  SUBSCRIPTION_PRICE_CENTS,
} from "./stripe";
import { getSubscriptionView } from "./subscriptions";

/** Our user's Stripe customer id. Created on first use and stored. */
export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await getStripe().customers.create(
    { email: user.email, metadata: { userId } },
    // Stripe's own idempotency key: two requests with the same key create
    // one customer, even if both reach Stripe.
    { idempotencyKey: `customer:${userId}` },
  );
  await db
    .update(users)
    .set({ stripeCustomerId: customer.id })
    .where(eq(users.id, userId));
  return customer.id;
}

export type StartCheckoutResult =
  | { status: "redirect"; url: string }
  | { status: "already_paid" }
  | { status: "wrong_kind" };

/**
 * Starts the $9 one-time payment for one eulogy.
 * Returns null if the user does not own the story.
 *
 * The amount is set here on the server. The browser never sends a price.
 */
export async function startEulogyCheckout(
  userId: string,
  storyId: string,
): Promise<StartCheckoutResult | null> {
  const story = await getStoryForUser(userId, storyId);
  if (!story) return null;
  if (story.kind !== "eulogy") return { status: "wrong_kind" };

  // Do not sell the same thing twice.
  if ((await getEulogyPayment(userId, storyId)) === "paid_unused") {
    return { status: "already_paid" };
  }

  const customer = await getOrCreateStripeCustomer(userId);
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer,
    // This sandbox has Stripe "Managed Payments" (Stripe as the seller, with
    // tax handling) on by default. This project does not build tax, so each
    // session turns it off.
    managed_payments: { enabled: false },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: EULOGY_PRICE_CENTS,
          product_data: { name: "StoryKeep Eulogy", description: story.title },
        },
      },
    ],
    // The webhook reads these to know who paid for what.
    metadata: { userId, storyId: story.id },
    success_url: `${appUrl()}/stories/${story.id}?checkout=success`,
    cancel_url: `${appUrl()}/stories/${story.id}?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");

  // Remember the session as a pending order. It becomes "paid" only when the
  // webhook says so. The success page alone unlocks nothing.
  await getDb().insert(orders).values({
    userId,
    storyId: story.id,
    stripeCheckoutSessionId: session.id,
    amountCents: EULOGY_PRICE_CENTS,
    currency: CURRENCY,
    status: "pending",
  });

  return { status: "redirect", url: session.url };
}

export type StartSubscriptionResult =
  | { status: "redirect"; url: string }
  | { status: "already_subscribed" };

/** Starts the $7/month subscription on Stripe-hosted Checkout. */
export async function startSubscriptionCheckout(
  userId: string,
): Promise<StartSubscriptionResult> {
  // Never sell a second subscription to a user who has one that is active
  // or still being retried. They should fix their card in the portal instead.
  const { row } = await getSubscriptionView(userId);
  if (row && (row.status === "active" || row.status === "past_due")) {
    return { status: "already_subscribed" };
  }

  const customer = await getOrCreateStripeCustomer(userId);
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    managed_payments: { enabled: false },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: SUBSCRIPTION_PRICE_CENTS,
          recurring: { interval: "month" },
          product_data: { name: "StoryKeep Life Story (monthly)" },
        },
      },
    ],
    // Copied onto the subscription, so its webhooks can find our user even
    // before the customer id is stored.
    subscription_data: { metadata: { userId } },
    success_url: `${appUrl()}/billing?checkout=success`,
    cancel_url: `${appUrl()}/billing?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return { status: "redirect", url: session.url };
}

let portalConfigurationId: string | undefined;

// The Customer Portal needs a saved configuration. Create ours once through
// the API, so setup does not depend on clicking in the Stripe dashboard.
async function getPortalConfiguration(): Promise<string> {
  if (portalConfigurationId) return portalConfigurationId;
  const stripe = getStripe();

  const existing = await stripe.billingPortal.configurations.list({ limit: 100 });
  const ours = existing.data.find(
    (config) => config.active && config.metadata?.app === "storykeep",
  );
  const config =
    ours ??
    (await stripe.billingPortal.configurations.create({
      metadata: { app: "storykeep" },
      business_profile: { headline: "Manage your StoryKeep subscription" },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
      },
    }));
  portalConfigurationId = config.id;
  return config.id;
}

/**
 * A link to Stripe's Customer Portal, where the user updates their card or
 * cancels. Null if the user has never been a Stripe customer.
 */
export async function createPortalUrl(userId: string): Promise<string | null> {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId));
  if (!user?.stripeCustomerId) return null;

  const session = await getStripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    configuration: await getPortalConfiguration(),
    return_url: `${appUrl()}/billing`,
  });
  return session.url;
}
