import type Stripe from "stripe";

let counter = 0;
const next = (prefix: string) => `${prefix}_test_${Date.now()}_${++counter}`;

/** Builds a Stripe event the way Stripe sends it. Only the fields we read. */
export function stripeEvent(
  type: string,
  object: object,
  overrides: { id?: string; created?: number } = {},
): Stripe.Event {
  return {
    id: overrides.id ?? next("evt"),
    object: "event",
    type,
    created: overrides.created ?? Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object },
  } as unknown as Stripe.Event;
}

export function checkoutCompletedEvent(input: {
  userId: string;
  storyId: string;
  sessionId?: string;
  paymentStatus?: "paid" | "unpaid";
  eventId?: string;
}): Stripe.Event {
  return stripeEvent(
    "checkout.session.completed",
    {
      id: input.sessionId ?? next("cs"),
      object: "checkout.session",
      mode: "payment",
      payment_status: input.paymentStatus ?? "paid",
      payment_intent: next("pi"),
      amount_total: 900,
      currency: "usd",
      metadata: { userId: input.userId, storyId: input.storyId },
    },
    { id: input.eventId },
  );
}
