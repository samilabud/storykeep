import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { orders } from "@/db/schema";
import { getStoryForUser, type Tx } from "@/stories/data";

export type Order = typeof orders.$inferSelect;

/**
 * A paid order for this story that has not been used yet, locked for the
 * rest of the transaction. One paid order buys one eulogy generation.
 */
export async function lockUnusedPaidOrder(
  tx: Tx,
  userId: string,
  storyId: string,
): Promise<Order | null> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.storyId, storyId),
        eq(orders.status, "paid"),
        isNull(orders.consumedAt),
      ),
    )
    .orderBy(asc(orders.createdAt))
    .limit(1)
    .for("update");
  return order ?? null;
}

export async function consumeOrder(tx: Tx, orderId: string, now: Date) {
  await tx.update(orders).set({ consumedAt: now }).where(eq(orders.id, orderId));
}

export type EulogyPayment = "unpaid" | "paid_unused" | "paid_used";

/** What the story page shows. Read from our database, never from the browser. */
export async function getEulogyPayment(
  userId: string,
  storyId: string,
): Promise<EulogyPayment | null> {
  const story = await getStoryForUser(userId, storyId);
  if (!story) return null;

  const paid = await getDb()
    .select({ consumedAt: orders.consumedAt })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.storyId, story.id),
        eq(orders.status, "paid"),
      ),
    )
    .orderBy(desc(orders.createdAt));
  if (paid.length === 0) return "unpaid";
  return paid.some((order) => order.consumedAt === null) ? "paid_unused" : "paid_used";
}
