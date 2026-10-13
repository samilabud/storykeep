import type { Story } from "@/stories/data";
import { getEulogyPayment } from "./orders";
import { getSubscriptionView } from "./subscriptions";

/**
 * May this user download this story as a file?
 *
 *   eulogy     -> a paid order for this story (used or not: they paid for it)
 *   life story -> a subscription with access right now
 *
 * Like every gate in the app, this reads only our own tables, which are
 * written by verified Stripe webhooks.
 */
export async function canExportStory(
  story: Pick<Story, "id" | "userId" | "kind">,
  now: Date = new Date(),
): Promise<boolean> {
  if (story.kind === "eulogy") {
    const payment = await getEulogyPayment(story.userId, story.id);
    return payment === "paid_unused" || payment === "paid_used";
  }
  return (await getSubscriptionView(story.userId, now)).hasAccess;
}
