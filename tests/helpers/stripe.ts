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

const DAY = 24 * 60 * 60;

/** A customer.subscription.* event. `at` is Stripe's event time in seconds. */
export function subscriptionEvent(
  type: "created" | "updated" | "deleted",
  input: {
    customerId: string;
    status: string;
    at: number;
    subscriptionId?: string;
    periodEnd?: number;
    cancelAtPeriodEnd?: boolean;
    userId?: string;
  },
): Stripe.Event {
  return stripeEvent(
    `customer.subscription.${type}`,
    {
      id: input.subscriptionId ?? "sub_test_1",
      object: "subscription",
      customer: input.customerId,
      status: input.status,
      cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
      cancel_at: null,
      metadata: input.userId ? { userId: input.userId } : {},
      items: { data: [{ current_period_end: input.periodEnd ?? input.at + 30 * DAY }] },
    },
    { created: input.at },
  );
}

/** An invoice.paid or invoice.payment_failed event for a subscription. */
export function invoiceEvent(
  type: "paid" | "payment_failed",
  input: {
    customerId: string;
    at: number;
    subscriptionId?: string;
    invoiceId?: string;
    attemptCount?: number;
    eventId?: string;
  },
): Stripe.Event {
  return stripeEvent(
    `invoice.${type}`,
    {
      id: input.invoiceId ?? "in_test_1",
      object: "invoice",
      customer: input.customerId,
      attempt_count: input.attemptCount ?? 1,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: input.subscriptionId ?? "sub_test_1" },
      },
    },
    { created: input.at, id: input.eventId },
  );
}
