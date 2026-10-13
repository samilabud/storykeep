import Link from "next/link";
import { Suspense } from "react";
import { requireStoryOwner } from "@/auth/guards";
import { getAnswerHistory, getCurrentAnswers } from "@/questionnaire/data";
import {
  isQuestionKey,
  nextQuestionKey,
  QUESTIONS,
} from "@/questionnaire/questions";
import { saveAnswerAction } from "../actions";

type Props = PageProps<"/stories/[id]/questionnaire">;

export default function QuestionnairePage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Questionnaire params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Questionnaire({ params, searchParams }: Props) {
  const { id } = await params;
  const { q } = await searchParams;
  const story = await requireStoryOwner(id);
  const answers =
    (await getCurrentAnswers(story.userId, story.id)) ?? new Map();

  // ?q=key opens one question to edit it. Without it, resume at the first
  // question that has no answer and no skip.
  const requested = typeof q === "string" && isQuestionKey(q) ? q : null;
  const activeKey = requested ?? nextQuestionKey(answers.keys());
  const active = QUESTIONS.find((question) => question.key === activeKey);
  const position = active ? QUESTIONS.indexOf(active) + 1 : null;

  const saved = active ? answers.get(active.key) : undefined;
  const history = active
    ? ((await getAnswerHistory(story.userId, story.id, active.key)) ?? [])
    : [];
  const earlier = history.slice(1);

  return (
    <>
      <Link href={`/stories/${story.id}`} className="text-sm underline">
        ← {story.title}
      </Link>

      {active ? (
        <form
          // A new key per question gives each question a fresh, empty form.
          key={active.key}
          action={saveAnswerAction.bind(null, story.id, active.key)}
          className="mt-6 flex flex-col gap-3"
        >
          <p className="text-sm text-zinc-500">
            Question {position} of {QUESTIONS.length}
          </p>
          <label htmlFor="answer" className="text-xl font-semibold">
            {active.label}
          </label>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {active.hint}
          </p>
          <textarea
            id="answer"
            name="answer"
            rows={6}
            maxLength={4000}
            defaultValue={saved?.answerText ?? ""}
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex gap-3">
            <button
              type="submit"
              name="intent"
              value="save"
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Save and continue
            </button>
            <button
              type="submit"
              name="intent"
              value="skip"
              className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
            >
              Skip this question
            </button>
          </div>

          {earlier.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
                Earlier answers ({earlier.length})
              </summary>
              <ol className="mt-2 flex flex-col gap-2">
                {earlier.map((answer) => (
                  <li
                    key={answer.id}
                    className="rounded bg-zinc-100 px-3 py-2 dark:bg-zinc-900"
                  >
                    {answer.skipped ? <em>Skipped</em> : answer.answerText}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </form>
      ) : (
        <div className="mt-6">
          <h1 className="text-xl font-semibold">All questions are done</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            You can still change any answer below.
          </p>
        </div>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-medium">Your answers</h2>
        <ol className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {QUESTIONS.map((question) => {
            const answer = answers.get(question.key);
            return (
              <li key={question.key} className="py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{question.label}</span>
                  <Link
                    href={`/stories/${story.id}/questionnaire?q=${question.key}`}
                    aria-label={`${answer ? "Edit" : "Answer"}: ${question.label}`}
                    className="shrink-0 underline"
                  >
                    {answer ? "Edit" : "Answer"}
                  </Link>
                </div>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                  {!answer
                    ? "Not answered yet"
                    : answer.skipped
                      ? "Skipped"
                      : answer.answerText}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
