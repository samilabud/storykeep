import Link from "next/link";
import { Suspense } from "react";
import { requireStoryOwner } from "@/auth/guards";
import { getAnswerHistory, getCurrentAnswers } from "@/questionnaire/data";
import {
  isQuestionKey,
  nextQuestionKey,
  QUESTIONS,
} from "@/questionnaire/questions";
import { SiteHeader } from "@/app/site-header";
import { SubmitButton } from "@/app/submit-button";
import {
  backLink,
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  muted,
  sectionTitle,
  textLink,
} from "@/app/ui";
import { saveAnswerAction } from "../actions";

type Props = PageProps<"/stories/[id]/questionnaire">;

export default function QuestionnairePage({ params, searchParams }: Props) {
  return (
    <>
      <SiteHeader variant="app" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Suspense fallback={<p className={muted}>Loading…</p>}>
          <Questionnaire params={params} searchParams={searchParams} />
        </Suspense>
      </main>
    </>
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

  const done = answers.size;
  const progress = Math.round((done / QUESTIONS.length) * 100);

  return (
    <>
      <Link href={`/stories/${story.id}`} className={backLink}>
        ← {story.title}
      </Link>

      <div
        role="progressbar"
        aria-label="Questionnaire progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="mt-6 h-1.5 overflow-hidden rounded-full bg-accent-soft"
      >
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>

      {active ? (
        <form
          // A new key per question gives each question a fresh, empty form.
          key={active.key}
          action={saveAnswerAction.bind(null, story.id, active.key)}
          className={`${card} mt-6 flex flex-col gap-3`}
        >
          <p className="text-sm font-medium text-accent">
            Question {position} of {QUESTIONS.length}
          </p>
          <label htmlFor="answer" className="font-display text-2xl font-semibold text-balance">
            {active.label}
          </label>
          <p className={muted}>{active.hint}</p>
          <textarea
            id="answer"
            name="answer"
            rows={7}
            maxLength={4000}
            autoFocus
            defaultValue={saved?.answerText ?? ""}
            placeholder="Write as much or as little as you like."
            className={`${field} leading-relaxed`}
          />
          <div className="flex flex-wrap gap-3">
            <SubmitButton name="intent" value="save" className={buttonPrimary}>
              Save and continue
            </SubmitButton>
            <SubmitButton name="intent" value="skip" className={buttonSecondary}>
              Skip this question
            </SubmitButton>
          </div>

          {earlier.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-muted hover:text-ink">
                Earlier answers ({earlier.length})
              </summary>
              <ol className="mt-2 flex flex-col gap-2">
                {earlier.map((answer) => (
                  <li key={answer.id} className="rounded-lg bg-paper px-3 py-2">
                    {answer.skipped ? <em>Skipped</em> : answer.answerText}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </form>
      ) : (
        <div className={`${card} mt-6`}>
          <h1 className="font-display text-2xl font-semibold">All questions are done</h1>
          <p className={`mt-1 ${muted}`}>You can still change any answer below.</p>
          <Link href={`/stories/${story.id}`} className={`mt-4 ${buttonPrimary}`}>
            Back to the story
          </Link>
        </div>
      )}

      <section className="mt-10">
        <h2 className={sectionTitle}>Your answers</h2>
        <ol className="mt-3 flex flex-col gap-2">
          {QUESTIONS.map((question, index) => {
            const answer = answers.get(question.key);
            const isActive = question.key === active?.key;
            return (
              <li
                key={question.key}
                className={`rounded-xl border bg-surface px-4 py-3 text-sm ${
                  isActive ? "border-accent" : "border-line"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex gap-2 font-medium">
                    <span aria-hidden className="text-muted">{index + 1}.</span>
                    {question.label}
                  </span>
                  <Link
                    href={`/stories/${story.id}/questionnaire?q=${question.key}`}
                    aria-label={`${answer ? "Edit" : "Answer"}: ${question.label}`}
                    className={`${textLink} shrink-0`}
                  >
                    {answer ? "Edit" : "Answer"}
                  </Link>
                </div>
                <p className={`mt-1 pl-5 whitespace-pre-wrap ${answer && !answer.skipped ? "" : "italic"} text-muted`}>
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
