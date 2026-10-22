import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/auth/guards";
import { getSubscriptionView } from "@/billing/subscriptions";
import { AutoRefresh } from "@/app/stories/[id]/auto-refresh";
import { SiteHeader } from "@/app/site-header";
import { SubmitButton } from "@/app/submit-button";
import { backLink, badge, buttonPrimary, card, muted, pageTitle, sectionTitle } from "@/app/ui";
import { openPortalAction, subscribeAction } from "./actions";

export const metadata = { title: "Billing · StoryKeep" };

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export default function BillingPage({ searchParams }: PageProps<"/billing">) {
  return (
    <>
      <SiteHeader variant="app" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <Link href="/stories" className={backLink}>
          ← My stories
        </Link>
        <h1 className={`mt-4 ${pageTitle}`}>Billing</h1>
        <Suspense fallback={<p className={`mt-6 ${muted}`}>Loading…</p>}>
          <Billing searchParams={searchParams} />
        </Suspense>
        <p className={`mt-6 ${muted}`}>
          Eulogies are paid once per draft, on the story&apos;s page. Card details
          are handled by Stripe and never reach StoryKeep.
        </p>
      </main>
    </>
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
    <section className={`${card} mt-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={sectionTitle}>Life Story subscription</h2>
          <p className={`mt-1 ${muted}`}>
            $7 per month. Unlimited Life Story drafts and downloads.
          </p>
        </div>
        <span className={badge}>{hasAccess ? "Access on" : "No access"}</span>
      </div>

      <p className="mt-4 rounded-lg bg-paper px-3 py-2 text-sm">
        Status: <strong data-testid="subscription-status">{status}</strong>
        {" · "}
        Access:{" "}
        <strong data-testid="subscription-access">{hasAccess ? "yes" : "no"}</strong>
      </p>

      {confirming ? (
        <p role="status" className={`mt-3 ${muted}`}>
          Confirming your subscription…
          <AutoRefresh />
        </p>
      ) : status === "active" ? (
        <>
          <p className={`mt-3 ${muted}`}>
            {row?.cancelAtPeriodEnd
              ? "Your subscription is cancelled and ends on "
              : "Your next payment is on "}
            {row?.currentPeriodEnd ? formatDate(row.currentPeriodEnd) : "the next renewal date"}.
          </p>
          <form action={openPortalAction} className="mt-3">
            <SubmitButton className={buttonPrimary}>
              Manage subscription
            </SubmitButton>
          </form>
        </>
      ) : status === "past_due" ? (
        <>
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {graceUntil
              ? `Your last payment failed. You keep access until ${formatDate(graceUntil)}. We will try your card again.`
              : "Your last payment failed and the grace period is over. Update your card to get access back."}
          </p>
          <form action={openPortalAction} className="mt-3">
            <SubmitButton className={buttonPrimary}>
              Update your card
            </SubmitButton>
          </form>
        </>
      ) : (
        <>
          {(status === "canceled" || status === "unpaid") && (
            <p className={`mt-3 ${muted}`}>
              Your subscription has ended. Your stories are still saved.
            </p>
          )}
          {checkout === "cancelled" && (
            <p className={`mt-3 ${muted}`}>
              Checkout cancelled. You were not charged.
            </p>
          )}
          <form action={subscribeAction} className="mt-3">
            <SubmitButton className={buttonPrimary}>
              Subscribe for $7/month
            </SubmitButton>
          </form>
        </>
      )}
    </section>
  );
}
