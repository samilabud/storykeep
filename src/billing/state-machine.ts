// The subscription state machine. Pure functions: no database, no Stripe, no
// clock. Each takes the state we have and one event, and returns the next
// state, or null when the event must be ignored.
//
//   (none) --created/updated--> active <--invoice.paid---+
//                                 |                      |
//                    invoice.payment_failed              |
//                                 v                      |
//                             past_due  (grace: 3 days)--+
//                                 |
//                 all retries failed / user cancelled
//                                 v
//                         canceled or unpaid   (no access)
//
// Stripe does not promise the order of events. Each rule below says what to
// do when an event arrives late.

export type SubscriptionStatus =
  | "incomplete"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid";

export type SubscriptionState = {
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** While past_due, the user keeps access until this moment. */
  graceUntil: Date | null;
  /** `created` time of the newest subscription snapshot applied. */
  lastEventCreatedAt: Date | null;
  /** `created` time of the newest invoice.paid seen. */
  lastPaidEventAt: Date | null;
};

/** What a customer.subscription.* event tells us about the subscription. */
export type SubscriptionSnapshot = {
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type SnapshotEventType =
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted";

export const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

const graceFrom = (start: Date) => new Date(start.getTime() + GRACE_PERIOD_MS);
const latest = (a: Date | null, b: Date) => (a && a > b ? a : b);

/** Statuses a user can replace by subscribing again. */
const ENDED: SubscriptionStatus[] = ["canceled", "unpaid", "incomplete"];

/** Stripe has more statuses than this app needs. Map them to ours. */
export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
    case "paused":
      return "unpaid";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "incomplete";
  }
}

/** customer.subscription.created / updated / deleted */
export function applySnapshot(
  prev: SubscriptionState | null,
  snapshot: SubscriptionSnapshot,
  type: SnapshotEventType,
  created: Date,
): SubscriptionState | null {
  const deleted = type === "customer.subscription.deleted";
  const status = deleted ? "canceled" : snapshot.status;

  const fresh = (): SubscriptionState => ({
    ...snapshot,
    status,
    graceUntil: status === "past_due" ? graceFrom(created) : null,
    lastEventCreatedAt: created,
    lastPaidEventAt: null,
  });

  if (!prev) return fresh();

  if (prev.stripeSubscriptionId !== snapshot.stripeSubscriptionId) {
    // A different subscription for the same user. Accept it only if the one
    // we hold has ended (the user subscribed again). Otherwise it is a late
    // event from an old subscription.
    return ENDED.includes(prev.status) && !deleted ? fresh() : null;
  }

  // Rule 1: canceled is final. Nothing brings this subscription back.
  if (prev.status === "canceled") return null;

  // Rule 2: "deleted" always wins, even if it looks old.
  if (deleted) {
    return {
      ...prev,
      status: "canceled",
      graceUntil: null,
      lastEventCreatedAt: latest(prev.lastEventCreatedAt, created),
    };
  }

  // Rule 3: "created" is by definition the first event. If we already hold
  // this subscription, we have newer information.
  if (type === "customer.subscription.created") return null;

  // Rule 4: a snapshot older than the newest one we applied is stale.
  if (prev.lastEventCreatedAt && created < prev.lastEventCreatedAt) return null;

  // Rule 5: a "past_due" snapshot from before the last successful payment
  // describes a failure that was already recovered.
  if (
    status === "past_due" &&
    prev.lastPaidEventAt &&
    created <= prev.lastPaidEventAt
  ) {
    return null;
  }

  return {
    ...prev,
    ...snapshot,
    status,
    // Grace starts at the first sign of trouble and is not extended by
    // later failures. Any other status clears it.
    graceUntil:
      status === "past_due" ? (prev.graceUntil ?? graceFrom(created)) : null,
    lastEventCreatedAt: created,
  };
}

/** invoice.payment_failed for a subscription invoice */
export function applyPaymentFailed(
  prev: SubscriptionState | null,
  created: Date,
): SubscriptionState | null {
  if (!prev) return null;

  // Rule 6: a failure older than the last successful payment is history.
  if (prev.lastPaidEventAt && created <= prev.lastPaidEventAt) return null;

  // Rule 6b: we hold an "active" snapshot that is newer than this failure,
  // so Stripe itself said the subscription recovered after it. This covers
  // the case where the recovery payment event was missed.
  if (
    prev.status === "active" &&
    prev.lastEventCreatedAt &&
    created < prev.lastEventCreatedAt
  ) {
    return null;
  }

  // Only a paying subscription can become past due. A first payment that
  // fails leaves it "incomplete", and ended subscriptions stay ended.
  if (prev.status !== "active" && prev.status !== "past_due") return null;

  return {
    ...prev,
    status: "past_due",
    graceUntil: prev.graceUntil ?? graceFrom(created),
  };
}

/** invoice.paid for a subscription invoice */
export function applyInvoicePaid(
  prev: SubscriptionState | null,
  created: Date,
): SubscriptionState | null {
  if (!prev) return null;
  if (prev.status === "canceled") return null;

  const next = { ...prev, lastPaidEventAt: latest(prev.lastPaidEventAt, created) };

  // Rule 7: only a payment newer than the newest snapshot may change the
  // status. An old invoice.paid that arrives late still moves the "last
  // paid" mark (so rule 6 works) but must not undo a newer past_due.
  const newerThanSnapshot =
    !prev.lastEventCreatedAt || created >= prev.lastEventCreatedAt;
  if (prev.status === "past_due" && newerThanSnapshot) {
    return { ...next, status: "active", graceUntil: null };
  }
  return next;
}

/**
 * The one access rule. Everything that gates subscriber features calls this.
 * `now` is a parameter, so the end of the grace period needs no event and no
 * cron job: access simply stops when the clock passes graceUntil.
 */
export function hasSubscriptionAccess(
  state: Pick<SubscriptionState, "status" | "graceUntil"> | null,
  now: Date,
): boolean {
  if (!state) return false;
  if (state.status === "active") return true;
  if (state.status === "past_due") {
    return state.graceUntil !== null && now < state.graceUntil;
  }
  return false;
}
