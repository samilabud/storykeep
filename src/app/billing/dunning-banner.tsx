import Link from "next/link";
import { getSessionUserId } from "@/auth/guards";
import { getSubscriptionView } from "@/billing/subscriptions";

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/**
 * Shown on every signed-in page while a renewal payment has failed and the
 * user is still inside the grace period. Wrap it in <Suspense>.
 */
export async function DunningBanner() {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const { graceUntil } = await getSubscriptionView(userId);
  if (!graceUntil) return null;

  return (
    <div
      role="alert"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      <strong>Your last payment did not go through.</strong> You keep access
      until {formatDate(graceUntil)}.{" "}
      <Link href="/billing" className="font-medium underline">
        Update your card
      </Link>
    </div>
  );
}
