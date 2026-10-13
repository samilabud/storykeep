import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/auth/guards";
import { getSubscriptionView } from "@/billing/subscriptions";
import { AutoRefresh } from "@/app/stories/[id]/auto-refresh";
import { openPortalAction, subscribeAction } from "./actions";

export const metadata = { title: "Billing · StoryKeep" };

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

const button =
  "rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900";

export default function BillingPage({ searchParams }: PageProps<"/billing">) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/stories" className="text-sm underline">
        ← My stories
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Billing</h1>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Billing searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Billing({ searchParams }: Pick<PageProps<"/billing">, "searchParams">) {
  const userId = await requireUser();
  const { checkout } = await searchParams;
  const { row, hasAccess, graceUntil } = await getSubscriptionView(userId);

  const status = row?.status ?? "none";
  // Back from Stripe, but the webhook has not arrived yet. Wait for it.
  const confirming = checkout === "success" && status !== "active";

  return (
    <section className="mt-6 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-lg font-medium">Life Story subscription</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        $7 per month. Unlimited Life Story drafts and downloads.
      </p>

      <p className="mt-4 text-sm">
        Status: <strong data-testid="subscription-status">{status}</strong>
        {" · "}
        Access:{" "}
        <strong data-testid="subscription-access">{hasAccess ? "yes" : "no"}</strong>
      </p>

      {confirming ? (
        <p role="status" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Confirming your subscription…
          <AutoRefresh />
        </p>
      ) : status === "active" ? (
        <>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {row?.cancelAtPeriodEnd
              ? "Your subscription is cancelled and ends on "
              : "Your next payment is on "}
            {row?.currentPeriodEnd ? formatDate(row.currentPeriodEnd) : "the next renewal date"}.
          </p>
          <form action={openPortalAction} className="mt-3">
            <button type="submit" className={button}>
              Manage subscription
            </button>
          </form>
        </>
      ) : status === "past_due" ? (
        <>
          <p role="alert" className="mt-3 text-sm text-red-600">
            {graceUntil
              ? `Your last payment failed. You keep access until ${formatDate(graceUntil)}. We will try your card again.`
              : "Your last payment failed and the grace period is over. Update your card to get access back."}
          </p>
          <form action={openPortalAction} className="mt-3">
            <button type="submit" className={button}>
              Update your card
            </button>
          </form>
        </>
      ) : (
        <>
          {(status === "canceled" || status === "unpaid") && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Your subscription has ended. Your stories are still saved.
            </p>
          )}
          {checkout === "cancelled" && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Checkout cancelled. You were not charged.
            </p>
          )}
          <form action={subscribeAction} className="mt-3">
            <button type="submit" className={button}>
              Subscribe for $7/month
            </button>
          </form>
        </>
      )}
    </section>
  );
}
