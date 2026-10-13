import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "@/db/client";
import { stripeEvents } from "@/db/schema";
import { handleStripeEvent } from "./webhook-handlers";

export type ProcessResult = "processed" | "duplicate";

/**
 * Applies one verified Stripe event exactly once.
 *
 * Stripe delivers "at least once": the same event can arrive twice (their
 * retry, a network timeout, or someone replaying it). The fix is one table:
 *
 *   1. INSERT the event id into stripe_events. The id is the PRIMARY KEY.
 *   2. If the insert added no row, we have seen this event. Stop.
 *   3. Otherwise apply the changes.
 *
 * Steps 1 and 3 run in ONE transaction. If step 3 throws, the insert is
 * rolled back too, so Stripe's retry gets a clean second chance. Without the
 * shared transaction a crash after step 1 would lose the event forever.
 */
export async function processStripeEvent(
  event: Stripe.Event,
): Promise<ProcessResult> {
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(stripeEvents)
      .values({
        id: event.id,
        type: event.type,
        created: new Date(event.created * 1000),
        payload: event,
      })
      // Two deliveries at the same moment: the second waits here for the
      // first to commit, then sees the conflict and inserts nothing.
      .onConflictDoNothing({ target: stripeEvents.id })
      .returning({ id: stripeEvents.id });
    if (inserted.length === 0) return "duplicate";

    await handleStripeEvent(tx, event);

    await tx
      .update(stripeEvents)
      .set({ processedAt: new Date() })
      .where(eq(stripeEvents.id, event.id));
    return "processed";
  });
}
