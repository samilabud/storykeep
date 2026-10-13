import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "@/db/client";
import { subscriptions, users } from "@/db/schema";
import { queueEmail } from "@/email/outbox";
import { paymentFailedEmail, subscriptionEndedEmail } from "@/email/templates";
import type { Tx } from "@/stories/data";
import {
  applyInvoicePaid,
  applyPaymentFailed,
  applySnapshot,
  hasSubscriptionAccess,
  mapStripeStatus,
  type SnapshotEventType,
  type SubscriptionState,
} from "./state-machine";

// This file connects the pure state machine to the database. Each handler:
// lock the user, load the state, ask the state machine, save the answer.

type User = typeof users.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;

const idOf = (ref: string | { id: string } | null | undefined) =>
  typeof ref === "string" ? ref : (ref?.id ?? null);

/**
 * Finds our user for a Stripe customer and locks the row. The lock makes all
 * subscription events for one user run one after another, so two webhooks
 * arriving together cannot both read the old state.
 */
async function lockUserByCustomer(
  tx: Tx,
  customerId: string | null,
  fallbackUserId?: string,
): Promise<User | null> {
  if (customerId) {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .for("update");
    if (user) return user;
  }
  if (fallbackUserId) {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, fallbackUserId))
      .for("update");
    return user ?? null;
  }
  return null;
}

async function loadState(tx: Tx, userId: string): Promise<SubscriptionState | null> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  return row ?? null;
}

async function saveState(tx: Tx, userId: string, state: SubscriptionState) {
  const values = {
    stripeSubscriptionId: state.stripeSubscriptionId,
    status: state.status,
    currentPeriodEnd: state.currentPeriodEnd,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    graceUntil: state.graceUntil,
    lastEventCreatedAt: state.lastEventCreatedAt,
    lastPaidEventAt: state.lastPaidEventAt,
    updatedAt: new Date(),
  };
  await tx
    .insert(subscriptions)
    .values({ userId, ...values })
    // One row per user. A new subscription replaces the ended one.
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
}

/** customer.subscription.created / updated / deleted */
export async function onSubscriptionEvent(
  tx: Tx,
  subscription: Stripe.Subscription,
  type: SnapshotEventType,
  created: Date,
) {
  const user = await lockUserByCustomer(
    tx,
    idOf(subscription.customer),
    subscription.metadata?.userId,
  );
  // Not one of our users (for example another app on the same Stripe
  // account). Nothing to do, and not an error worth a retry.
  if (!user) return;

  const periodEnd = subscription.items?.data[0]?.current_period_end;
  const prev = await loadState(tx, user.id);
  const next = applySnapshot(
    prev,
    {
      stripeSubscriptionId: subscription.id,
      status: mapStripeStatus(subscription.status),
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd:
        subscription.cancel_at_period_end || subscription.cancel_at != null,
    },
    type,
    created,
  );
  if (!next) return; // late or irrelevant event

  await saveState(tx, user.id, next);

  const justEnded =
    (next.status === "canceled" || next.status === "unpaid") &&
    prev?.status !== next.status;
  if (justEnded) {
    await queueEmail(
      tx,
      `email:subscription-ended:${subscription.id}`,
      subscriptionEndedEmail(user.email),
    );
  }
}

/** invoice.payment_failed */
export async function onInvoicePaymentFailed(
  tx: Tx,
  invoice: Stripe.Invoice,
  created: Date,
) {
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return; // a one-time invoice, not a subscription

  const user = await lockUserByCustomer(tx, idOf(invoice.customer));
  if (!user) return;

  const prev = await loadState(tx, user.id);
  if (prev?.stripeSubscriptionId !== subscriptionId) return;

  const next = applyPaymentFailed(prev, created);
  if (!next) return;
  await saveState(tx, user.id, next);

  // One email per failed attempt. Stripe's attempt counter is in the key, so
  // a replayed event cannot queue the same email twice.
  await queueEmail(
    tx,
    `email:payment-failed:${invoice.id}:${invoice.attempt_count}`,
    paymentFailedEmail(user.email, next.graceUntil!),
  );
}

/** invoice.paid */
export async function onInvoicePaid(tx: Tx, invoice: Stripe.Invoice, created: Date) {
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return;

  const user = await lockUserByCustomer(tx, idOf(invoice.customer));
  if (!user) return;

  const prev = await loadState(tx, user.id);
  if (prev?.stripeSubscriptionId !== subscriptionId) return;

  const next = applyInvoicePaid(prev, created);
  if (next) await saveState(tx, user.id, next);
}

export type SubscriptionView = {
  row: SubscriptionRow | null;
  /** True if the user may use subscriber features right now. */
  hasAccess: boolean;
  /** Set while a payment has failed and the user is still inside the grace period. */
  graceUntil: Date | null;
};

/**
 * The subscription as the app sees it. Read from our own table, which only
 * webhooks write. The browser is never asked.
 */
export async function getSubscriptionView(
  userId: string,
  now: Date = new Date(),
): Promise<SubscriptionView> {
  const [row] = await getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  const hasAccess = hasSubscriptionAccess(row ?? null, now);
  return {
    row: row ?? null,
    hasAccess,
    graceUntil: row?.status === "past_due" && hasAccess ? row.graceUntil : null,
  };
}

/** Same rule, inside a transaction. Used by the draft gate. */
export async function hasSubscriptionAccessTx(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<boolean> {
  return hasSubscriptionAccess(await loadState(tx, userId), now);
}
