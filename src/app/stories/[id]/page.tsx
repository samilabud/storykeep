import Link from "next/link";
import { after } from "next/server";
import { Suspense, type ReactNode } from "react";
import { requireStoryOwner } from "@/auth/guards";
import { canExportStory } from "@/billing/entitlement";
import { getEulogyPayment } from "@/billing/orders";
import { getSubscriptionView } from "@/billing/subscriptions";
import { runPendingJobsQuietly } from "@/jobs/run";
import { getCurrentAnswers } from "@/questionnaire/data";
import { nextQuestionKey, QUESTIONS } from "@/questionnaire/questions";
import { draftFailureMessage, getLatestDraftJob } from "@/stories/drafts";
import { listVersions } from "@/stories/versions";
import { SiteHeader } from "@/app/site-header";
import { SubmitButton } from "@/app/submit-button";
import {
  backLink,
  badge,
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  muted,
  pageTitle,
  sectionTitle,
  textLink,
} from "@/app/ui";
import {
  deleteStoryAction,
  requestDraftAction,
  saveStoryTextAction,
  startEulogyCheckoutAction,
} from "./actions";
import { StoryAssistant } from "./assistant";
import { AutoRefresh } from "./auto-refresh";
import { DeleteStory } from "./delete-story";

const SOURCE_LABEL = { llm_draft: "AI draft", user_edit: "Your edit" } as const;

// Server Actions of this page (and `after` work) may run this long. An LLM
// draft takes a few seconds.
export const maxDuration = 60;

type Props = PageProps<"/stories/[id]">;

export default function StoryPage({ params, searchParams }: Props) {
  return (
    <>
      <SiteHeader variant="app" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Link href="/stories" className={backLink}>
          ← My stories
        </Link>
        <Suspense fallback={<p className={`mt-6 ${muted}`}>Loading…</p>}>
          <StoryDetail params={params} searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

/** One numbered step of the story's journey. */
function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={card}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            done ? "bg-accent text-accent-ink" : "bg-accent-soft text-accent"
          }`}
        >
          {done ? "✓" : number}
        </span>
        <h2 className={sectionTitle}>{title}</h2>
      </div>
      <div className="mt-3 sm:pl-10">{children}</div>
    </section>
  );
}

async function StoryDetail({ params, searchParams }: Props) {
  const { id } = await params;
  const { checkout } = await searchParams;
  const story = await requireStoryOwner(id);
  const [answers, versions, draftJob, eulogyPayment, subscription, canExport] = await Promise.all([
    getCurrentAnswers(story.userId, story.id),
    listVersions(story.userId, story.id),
    getLatestDraftJob(story.userId, story.id),
    story.kind === "eulogy" ? getEulogyPayment(story.userId, story.id) : null,
    story.kind === "life_story" ? getSubscriptionView(story.userId) : null,
    canExportStory(story),
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

  const progress = Math.round((handled / QUESTIONS.length) * 100);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className={pageTitle}>{story.title}</h1>
        <span className={badge}>{story.kind === "eulogy" ? "Eulogy" : "Life Story"}</span>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <Step number={1} title="Questionnaire" done={handled === QUESTIONS.length}>
            <p className={muted}>
              {handled} of {QUESTIONS.length} questions done
            </p>
            <div
              role="progressbar"
              aria-label="Questionnaire progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="mt-2 h-2 overflow-hidden rounded-full bg-accent-soft"
            >
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
            <Link
              href={`/stories/${story.id}/questionnaire`}
              className={`mt-4 ${handled === 0 || next ? buttonPrimary : buttonSecondary}`}
            >
              {handled === 0
                ? "Start the questionnaire"
                : next
                  ? "Continue where you stopped"
                  : "Review your answers"}
            </Link>
          </Step>

          <Step number={2} title="AI draft" done={hasDraft && !drafting}>
            {drafting ? (
              <p role="status" className={`flex items-center gap-2 ${muted}`}>
                <span aria-hidden className="size-2 animate-pulse rounded-full bg-accent" />
                Writing your draft… This runs in the background. You can close
                this page and come back later.
                <AutoRefresh />
              </p>
            ) : (
              <>
                {draftError && (
                  <p
                    role="alert"
                    className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                  >
                    {draftError}
                  </p>
                )}
                {checkout === "cancelled" && needsPayment && (
                  <p className={`mb-3 ${muted}`}>Payment cancelled. You were not charged.</p>
                )}
                {eulogyPayment === "paid_unused" && (
                  <p className="mb-3 text-sm text-green-700 dark:text-green-400">
                    Payment received. Your eulogy draft is unlocked.
                  </p>
                )}
                {confirmingPayment ? (
                  <p role="status" className={muted}>
                    Confirming your payment…
                    <AutoRefresh />
                  </p>
                ) : needsPayment ? (
                  <form action={startEulogyCheckoutAction.bind(null, story.id)}>
                    <p className={`mb-3 ${muted}`}>
                      {eulogyPayment === "paid_used"
                        ? "Your paid draft has been written. Another draft is a new purchase."
                        : "One eulogy draft costs $9, paid once."}
                    </p>
                    <SubmitButton className={buttonPrimary}>Pay $9 with Stripe</SubmitButton>
                  </form>
                ) : needsSubscription ? (
                  <div>
                    <p className={`mb-3 ${muted}`}>
                      {subscription?.row && subscription.row.status !== "incomplete"
                        ? "Your subscription does not give access right now."
                        : "Life Story drafts are part of the $7/month subscription."}
                    </p>
                    <Link href="/billing" className={buttonPrimary}>
                      {subscription?.row && subscription.row.status !== "incomplete"
                        ? "Go to billing"
                        : "Subscribe to write drafts"}
                    </Link>
                  </div>
                ) : answered === 0 ? (
                  <p className={muted}>Answer at least one question to get a draft.</p>
                ) : (
                  <form action={requestDraftAction.bind(null, story.id)}>
                    <p className={`mb-3 ${muted}`}>
                      The draft uses only your answers. It becomes a new version
                      you can edit.
                    </p>
                    <SubmitButton className={hasDraft && !draftError ? buttonSecondary : buttonPrimary}>
                      {draftError
                        ? "Try again"
                        : hasDraft
                          ? "Write a new draft"
                          : "Write a draft from my answers"}
                    </SubmitButton>
                  </form>
                )}
              </>
            )}
          </Step>

          <Step number={3} title="Story text">
            <form
              action={saveStoryTextAction.bind(null, story.id)}
              className="flex flex-col gap-3"
            >
              <textarea
                name="content"
                aria-label="Story text"
                rows={16}
                required
                // The key makes React rebuild the box when a new version becomes
                // current, so it shows the saved text.
                key={current?.id ?? "empty"}
                defaultValue={current?.content ?? ""}
                placeholder="Write the story here, or ask for an AI draft above."
                className={`${field} font-display text-[1.05rem] leading-relaxed`}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted">
                  {current
                    ? `Editing version ${current.versionNo}. Saving never overwrites it.`
                    : "Saving creates version 1."}
                </span>
                <SubmitButton className={buttonPrimary} pendingLabel="Saving…">
                  Save as new version
                </SubmitButton>
              </div>
            </form>
          </Step>

          {current && (
            <Step number={4} title="Download">
              {canExport ? (
                <>
                  <p className={muted}>
                    The current version (version {current.versionNo}) as a file.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {(["pdf", "docx"] as const).map((format) => (
                      // A plain link, not <Link>: this is a file download, not a page.
                      <a
                        key={format}
                        href={`/api/stories/${story.id}/export?format=${format}`}
                        className={buttonSecondary}
                      >
                        Download {format === "pdf" ? "PDF" : "Word (DOCX)"}
                      </a>
                    ))}
                  </div>
                </>
              ) : (
                <p className={muted}>
                  {story.kind === "eulogy"
                    ? "Downloads are unlocked when the eulogy is paid for."
                    : "Downloads are part of the subscription."}
                </p>
              )}
            </Step>
          )}

          <section className={card}>
            <h2 className={sectionTitle}>Version history</h2>
            {!versions || versions.length === 0 ? (
              <p className={`mt-2 ${muted}`}>No versions yet.</p>
            ) : (
              <ol className="mt-2 divide-y divide-line">
                {versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <Link
                      href={`/stories/${story.id}/versions/${version.versionNo}`}
                      className={textLink}
                    >
                      Version {version.versionNo}
                    </Link>
                    <span className="text-muted">
                      {SOURCE_LABEL[version.source]}
                      {version.id === story.currentVersionId && (
                        <span className="font-medium text-accent"> · current</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className={card}>
            <h2 className={sectionTitle}>Delete this story</h2>
            <div className="mt-3">
              <DeleteStory
                action={deleteStoryAction.bind(null, story.id)}
                warning={
                  eulogyPayment === "paid_unused"
                    ? "You paid for a draft of this eulogy and have not used it yet. Deleting the story gives up that draft."
                    : undefined
                }
              />
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-6">
          <StoryAssistant storyId={story.id} hasAnswers={answered > 0} hasText={!!current} />
        </aside>
      </div>

      {/* On small screens the assistant sits below everything, so offer a shortcut. */}
      <a
        href="#assistant"
        className={`${buttonPrimary} fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] rounded-full shadow-lg lg:hidden`}
      >
        Ask the assistant
      </a>
    </>
  );
}
