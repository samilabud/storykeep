import { describe, expect, it } from "vitest";
import {
  applyInvoicePaid,
  applyPaymentFailed,
  applySnapshot,
  GRACE_PERIOD_MS,
  hasSubscriptionAccess,
  mapStripeStatus,
  type SnapshotEventType,
  type SubscriptionState,
  type SubscriptionStatus,
} from "@/billing/state-machine";

const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(Date.UTC(2026, 9, 1) + ms);

// A small event language for the tests.
type Ev =
  | { kind: "snapshot"; type: SnapshotEventType; status: SubscriptionStatus; t: number; periodEnd: number; sub?: string }
  | { kind: "paid"; t: number }
  | { kind: "failed"; t: number };

const snap = (
  type: "created" | "updated" | "deleted",
  status: SubscriptionStatus,
  t: number,
  periodEnd: number,
  sub = "sub_1",
): Ev => ({ kind: "snapshot", type: `customer.subscription.${type}`, status, t, periodEnd, sub });
const paid = (t: number): Ev => ({ kind: "paid", t });
const failed = (t: number): Ev => ({ kind: "failed", t });

function apply(state: SubscriptionState | null, ev: Ev): SubscriptionState | null {
  const created = at(ev.t);
  const next =
    ev.kind === "snapshot"
      ? applySnapshot(
          state,
          {
            stripeSubscriptionId: ev.sub ?? "sub_1",
            status: ev.status,
            currentPeriodEnd: at(ev.periodEnd),
            cancelAtPeriodEnd: false,
          },
          ev.type,
          created,
        )
      : ev.kind === "paid"
        ? applyInvoicePaid(state, created)
        : applyPaymentFailed(state, created);
  return next ?? state; // null means "ignored": keep what we had
}

const run = (events: Ev[]) => events.reduce(apply, null as SubscriptionState | null);

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/** One line per arrival order, so a failing order is easy to read. */
const describeOrder = (order: Ev[]) =>
  order
    .map((ev) =>
      ev.kind === "snapshot"
        ? `${ev.type.split(".")[2]}(${ev.status})@${ev.t}`
        : `${ev.kind}@${ev.t}`,
    )
    .join(" > ");

// Times in ms from the start. A month is 30 days here.
const MONTH = 30 * DAY;
const signup = [
  snap("created", "incomplete", 0, MONTH),
  paid(1000),
  snap("updated", "active", 1000, MONTH),
];
const renewalFails = [failed(MONTH), snap("updated", "past_due", MONTH, 2 * MONTH)];
const retrySucceeds = [
  paid(MONTH + 3 * DAY),
  snap("updated", "active", MONTH + 3 * DAY, 2 * MONTH),
];
const finalFailure = [
  failed(MONTH + 3 * DAY),
  failed(MONTH + 8 * DAY),
  snap("deleted", "canceled", MONTH + 8 * DAY, 2 * MONTH),
];

describe("subscription state machine: in order", () => {
  it("signup ends active", () => {
    expect(run(signup)).toMatchObject({ status: "active", graceUntil: null });
  });

  it("a failed renewal moves active to past_due and starts a 3 day grace period", () => {
    const state = run([...signup, ...renewalFails]);
    expect(state?.status).toBe("past_due");
    expect(state?.graceUntil).toEqual(at(MONTH + GRACE_PERIOD_MS));
  });

  it("a second failure does not extend the grace period", () => {
    const state = run([...signup, ...renewalFails, failed(MONTH + 2 * DAY)]);
    expect(state?.graceUntil).toEqual(at(MONTH + GRACE_PERIOD_MS));
  });

  it("a retry that succeeds returns to active and clears the grace period", () => {
    const state = run([...signup, ...renewalFails, ...retrySucceeds]);
    expect(state).toMatchObject({ status: "active", graceUntil: null });
    expect(state?.currentPeriodEnd).toEqual(at(2 * MONTH));
  });

  it("a final failure ends canceled", () => {
    const state = run([...signup, ...renewalFails, ...finalFailure]);
    expect(state).toMatchObject({ status: "canceled", graceUntil: null });
  });

  it("canceled is final: later events do not bring it back", () => {
    const state = run([
      ...signup,
      snap("deleted", "canceled", 5 * DAY, MONTH),
      paid(6 * DAY),
      snap("updated", "active", 7 * DAY, MONTH),
    ]);
    expect(state?.status).toBe("canceled");
  });

  it("a failed FIRST payment does not become past_due", () => {
    const state = run([snap("created", "incomplete", 0, MONTH), failed(1000)]);
    expect(state?.status).toBe("incomplete");
  });

  it("subscribing again after cancel replaces the old subscription", () => {
    const state = run([
      ...signup,
      snap("deleted", "canceled", 5 * DAY, MONTH),
      snap("created", "active", 9 * DAY, 9 * DAY + MONTH, "sub_2"),
    ]);
    expect(state).toMatchObject({ stripeSubscriptionId: "sub_2", status: "active" });
  });

  it("a late event from an old subscription does not touch the new one", () => {
    const state = run([
      ...signup,
      snap("deleted", "canceled", 5 * DAY, MONTH),
      snap("created", "active", 9 * DAY, 9 * DAY + MONTH, "sub_2"),
      snap("updated", "past_due", 4 * DAY, MONTH, "sub_1"),
      snap("deleted", "canceled", 5 * DAY, MONTH, "sub_1"),
    ]);
    expect(state).toMatchObject({ stripeSubscriptionId: "sub_2", status: "active" });
  });
});

describe("subscription state machine: out of order", () => {
  it("invoice.paid before subscription.updated ends active", () => {
    const state = run([snap("created", "incomplete", 0, MONTH), paid(1000), snap("updated", "active", 1000, MONTH)]);
    expect(state?.status).toBe("active");
  });

  it("subscription.created arriving last does not undo active", () => {
    const state = run([snap("updated", "active", 1000, MONTH), paid(1000), snap("created", "incomplete", 0, MONTH)]);
    expect(state?.status).toBe("active");
  });

  it("recovery: invoice.paid first, then the late past_due snapshot, ends active", () => {
    const state = run([
      ...signup,
      failed(MONTH),
      paid(MONTH + 3 * DAY),
      snap("updated", "past_due", MONTH, 2 * MONTH), // late
      snap("updated", "active", MONTH + 3 * DAY, 2 * MONTH),
    ]);
    expect(state).toMatchObject({ status: "active", graceUntil: null });
  });

  it("a late payment_failed after the recovery payment is ignored", () => {
    const state = run([...signup, ...retrySucceeds, failed(MONTH)]);
    expect(state).toMatchObject({ status: "active", graceUntil: null });
  });

  it("an old invoice.paid arriving late does not undo a newer past_due", () => {
    const state = run([
      snap("created", "active", 0, MONTH),
      ...renewalFails,
      paid(1000), // the payment from signup, a month late
    ]);
    expect(state?.status).toBe("past_due");
  });

  it("an older snapshot does not overwrite a newer one", () => {
    const state = run([
      snap("updated", "active", MONTH + 3 * DAY, 2 * MONTH),
      snap("updated", "past_due", MONTH, 2 * MONTH),
    ]);
    expect(state?.status).toBe("active");
  });

  // The strong check: every possible arrival order must end in the same state.
  it.each([
    ["signup", signup, "active"],
    ["signup, failed renewal", [...signup, ...renewalFails], "past_due"],
    ["signup, failed renewal, retry succeeds", [...signup, ...renewalFails, ...retrySucceeds], "active"],
    ["failed renewal, then final failure", [snap("created", "active", 0, MONTH), ...renewalFails, ...finalFailure], "canceled"],
  ] as const)("%s: every arrival order ends in the right state", (_name, events, expected) => {
    const orders = permutations([...events]);
    const wrong = orders
      .filter((order) => run(order)?.status !== expected)
      .map(describeOrder);
    expect(wrong).toEqual([]);
    expect(orders.length).toBeGreaterThanOrEqual(6);
  });

  it("recovery in any order also ends with no grace period and the new period end", () => {
    for (const order of permutations([...signup, ...renewalFails, ...retrySucceeds])) {
      const state = run(order);
      expect(state?.graceUntil).toBeNull();
      expect(state?.currentPeriodEnd).toEqual(at(2 * MONTH));
    }
  });
});

describe("access rule", () => {
  const base = { status: "past_due" as const, graceUntil: at(3 * DAY) };

  it("active has access", () => {
    expect(hasSubscriptionAccess({ status: "active", graceUntil: null }, at(0))).toBe(true);
  });

  it("past_due keeps access inside the grace period", () => {
    expect(hasSubscriptionAccess(base, at(3 * DAY - 1))).toBe(true);
  });

  it("past_due loses access the moment the grace period ends, with no event", () => {
    expect(hasSubscriptionAccess(base, at(3 * DAY))).toBe(false);
  });

  it.each(["canceled", "unpaid", "incomplete"] as const)("%s has no access", (status) => {
    expect(hasSubscriptionAccess({ status, graceUntil: null }, at(0))).toBe(false);
  });

  it("no subscription has no access", () => {
    expect(hasSubscriptionAccess(null, at(0))).toBe(false);
  });
});

describe("Stripe status mapping", () => {
  it.each([
    ["active", "active"],
    ["trialing", "active"],
    ["past_due", "past_due"],
    ["unpaid", "unpaid"],
    ["paused", "unpaid"],
    ["canceled", "canceled"],
    ["incomplete_expired", "canceled"],
    ["incomplete", "incomplete"],
    ["something_new", "incomplete"],
  ])("%s -> %s", (stripe, ours) => {
    expect(mapStripeStatus(stripe)).toBe(ours);
  });
});
