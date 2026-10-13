import Link from "next/link";
import { Suspense } from "react";
import { requireStoryOwner } from "@/auth/guards";
import { getCurrentAnswers } from "@/questionnaire/data";
import { nextQuestionKey, QUESTIONS } from "@/questionnaire/questions";
import { draftFailureMessage, getLatestDraftJob } from "@/stories/drafts";
import { listVersions } from "@/stories/versions";
import { requestDraftAction, saveStoryTextAction } from "./actions";
import { AutoRefresh } from "./auto-refresh";

const SOURCE_LABEL = { llm_draft: "AI draft", user_edit: "Your edit" } as const;

export default function StoryPage({ params }: PageProps<"/stories/[id]">) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/stories" className="text-sm underline">
        ← My stories
      </Link>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <StoryDetail params={params} />
      </Suspense>
    </main>
  );
}

async function StoryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = await requireStoryOwner(id);
  const [answers, versions, draftJob] = await Promise.all([
    getCurrentAnswers(story.userId, story.id),
    listVersions(story.userId, story.id),
    getLatestDraftJob(story.userId, story.id),
  ]);

  const handled = answers?.size ?? 0;
  const next = nextQuestionKey(answers?.keys() ?? []);
  const current = versions?.find((v) => v.id === story.currentVersionId);

  const answered = [...(answers?.values() ?? [])].filter((a) => !a.skipped).length;
  const drafting =
    draftJob?.status === "queued" || draftJob?.status === "running";
  const draftError = draftJob ? draftFailureMessage(draftJob) : null;
  const hasDraft = versions?.some((v) => v.source === "llm_draft") ?? false;

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
            {answered === 0 ? (
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
