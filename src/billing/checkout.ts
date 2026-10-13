import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { orders, users } from "@/db/schema";
import { getStoryForUser } from "@/stories/data";
import { getEulogyPayment } from "./orders";
import { appUrl, CURRENCY, EULOGY_PRICE_CENTS, getStripe } from "./stripe";

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
