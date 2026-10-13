import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { requireStoryOwner } from "@/auth/guards";
import { getEulogyPayment } from "@/billing/orders";
import { getSubscriptionView } from "@/billing/subscriptions";
import { runPendingJobsQuietly } from "@/jobs/run";
import { getCurrentAnswers } from "@/questionnaire/data";
import { nextQuestionKey, QUESTIONS } from "@/questionnaire/questions";
import { draftFailureMessage, getLatestDraftJob } from "@/stories/drafts";
import { listVersions } from "@/stories/versions";
import {
  requestDraftAction,
  saveStoryTextAction,
  startEulogyCheckoutAction,
} from "./actions";
import { AutoRefresh } from "./auto-refresh";

const SOURCE_LABEL = { llm_draft: "AI draft", user_edit: "Your edit" } as const;

// Server Actions of this page (and `after` work) may run this long. An LLM
// draft takes a few seconds.
export const maxDuration = 60;

type Props = PageProps<"/stories/[id]">;

export default function StoryPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/stories" className="text-sm underline">
        ← My stories
      </Link>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <StoryDetail params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function StoryDetail({ params, searchParams }: Props) {
  const { id } = await params;
  const { checkout } = await searchParams;
  const story = await requireStoryOwner(id);
  const [answers, versions, draftJob, eulogyPayment, subscription] = await Promise.all([
    getCurrentAnswers(story.userId, story.id),
    listVersions(story.userId, story.id),
    getLatestDraftJob(story.userId, story.id),
    story.kind === "eulogy" ? getEulogyPayment(story.userId, story.id) : null,
    story.kind === "life_story" ? getSubscriptionView(story.userId) : null,
  ]);

  const handled = answers?.size ?? 0;
  const next = nextQuestionKey(answers?.keys() ?? []);
  const current = versions?.find((v) => v.id === story.currentVersionId);

  const answered = [...(answers?.values() ?? [])].filter((a) => !a.skipped).length;
  const drafting =
    draftJob?.status === "queued" || draftJob?.status === "running";
  const draftError = draftJob ? draftFailureMessage(draftJob) : null;

  // No worker process on a serverless host. While a draft is waiting, the
  // page refreshes every 2 seconds, and each refresh gives the queue a push.
  // This picks up a retry after its backoff delay.
  if (drafting && process.env.VERCEL) after(runPendingJobsQuietly);
  const hasDraft = versions?.some((v) => v.source === "llm_draft") ?? false;

  // A eulogy needs a paid, unused order. A failed job may be retried for
  // free, because that payment has not produced a draft yet.
  const needsPayment =
    story.kind === "eulogy" && eulogyPayment !== "paid_unused" && !draftError;
  // A life story needs a subscription with access (active, or past due but
  // inside the grace period).
  const needsSubscription =
    story.kind === "life_story" && !subscription?.hasAccess && !draftError;

  // The browser came back from Stripe, but the webhook has not arrived yet.
  // Access comes from the webhook, so wait for it instead of trusting the URL.
  const confirmingPayment = needsPayment && checkout === "success" && !drafting;

  return (
    <>
      <h1 className="mt-4 text-2xl font-semibold">{story.title}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {story.kind === "eulogy" ? "Eulogy" : "Life Story"}
      </p>

      <section className="mt-8 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Questionnaire</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {handled} of {QUESTIONS.length} questions done
        </p>
        <Link
          href={`/stories/${story.id}/questionnaire`}
          className="mt-3 inline-block rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {handled === 0
            ? "Start the questionnaire"
            : next
              ? "Continue where you stopped"
              : "Review your answers"}
        </Link>
      </section>

      <section className="mt-8 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-medium">AI draft</h2>
        {drafting ? (
          <p role="status" className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Writing your draft… This runs in the background. You can close
            this page and come back later.
            <AutoRefresh />
          </p>
        ) : (
          <>
            {draftError && (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {draftError}
              </p>
            )}
            {checkout === "cancelled" && needsPayment && (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Payment cancelled. You were not charged.
              </p>
            )}
            {eulogyPayment === "paid_unused" && (
              <p className="mt-1 text-sm text-green-700 dark:text-green-500">
                Payment received. Your eulogy draft is unlocked.
              </p>
            )}
            {confirmingPayment ? (
              <p role="status" className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Confirming your payment…
                <AutoRefresh />
              </p>
            ) : needsPayment ? (
              <form
                action={startEulogyCheckoutAction.bind(null, story.id)}
                className="mt-3"
              >
                <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                  {eulogyPayment === "paid_used"
                    ? "Your paid draft has been written. Another draft is a new purchase."
                    : "One eulogy draft costs $9, paid once."}
                </p>
                <button
                  type="submit"
                  className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Pay $9 with Stripe
                </button>
              </form>
            ) : needsSubscription ? (
              <div className="mt-3">
                <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                  {subscription?.row && subscription.row.status !== "incomplete"
                    ? "Your subscription does not give access right now."
                    : "Life Story drafts are part of the $7/month subscription."}
                </p>
                <Link
                  href="/billing"
                  className="inline-block rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {subscription?.row && subscription.row.status !== "incomplete"
                    ? "Go to billing"
                    : "Subscribe to write drafts"}
                </Link>
              </div>
            ) : answered === 0 ? (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Answer at least one question to get a draft.
              </p>
            ) : (
              <form action={requestDraftAction.bind(null, story.id)} className="mt-3">
                <button
                  type="submit"
                  className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {draftError
                    ? "Try again"
                    : hasDraft
                      ? "Write a new draft"
                      : "Write a draft from my answers"}
                </button>
              </form>
            )}
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Story text</h2>
        <form
          action={saveStoryTextAction.bind(null, story.id)}
          className="mt-3 flex flex-col gap-3"
        >
          <textarea
            name="content"
            aria-label="Story text"
            rows={12}
            required
            // The key makes React rebuild the box when a new version becomes
            // current, so it shows the saved text.
            key={current?.id ?? "empty"}
            defaultValue={current?.content ?? ""}
            placeholder="Write the story here, or ask for an AI draft above."
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Save as new version
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Version history</h2>
        {!versions || versions.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No versions yet.</p>
        ) : (
          <ol className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/stories/${story.id}/versions/${version.versionNo}`}
                  className="underline"
                >
                  Version {version.versionNo}
                </Link>
                <span className="text-zinc-500">
                  {SOURCE_LABEL[version.source]}
                  {version.id === story.currentVersionId && " · current"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
