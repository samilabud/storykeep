import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { orders } from "@/db/schema";
import type { Tx } from "@/stories/data";

/**
 * Applies one event to our tables. Runs inside the transaction opened by
 * processStripeEvent. Event types we do not use are stored and ignored.
 */
export async function handleStripeEvent(tx: Tx, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await onCheckoutSessionPaid(tx, event.data.object);
      break;
    case "charge.refunded":
      await onChargeRefunded(tx, event.data.object);
      break;
  }
}

async function onCheckoutSessionPaid(tx: Tx, session: Stripe.Checkout.Session) {
  if (session.mode !== "payment") return; // subscriptions are handled in M5

  // "completed" means the customer finished the form. For slow payment
  // methods the money can still be on its way. Unlock only when it is paid.
  if (session.payment_status !== "paid") return;

  const { userId, storyId } = session.metadata ?? {};
  if (!userId || !storyId) {
    throw new Error(`Checkout session ${session.id} has no userId/storyId metadata`);
  }
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  // Upsert on the session id. Normally the pending order exists already and
  // is updated. If the webhook somehow arrives first, the order is created.
  await tx
    .insert(orders)
    .values({
      userId,
      storyId,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      status: "paid",
    })
    .onConflictDoUpdate({
      target: orders.stripeCheckoutSessionId,
      set: { status: "paid", stripePaymentIntentId: paymentIntentId },
    });
}

async function onChargeRefunded(tx: Tx, charge: Stripe.Charge) {
  if (!charge.refunded) return; // a partial refund keeps access
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  await tx
    .update(orders)
    .set({ status: "refunded" })
    .where(eq(orders.stripePaymentIntentId, paymentIntentId));
}
