import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs, questionnaireAnswers, storyVersions } from "@/db/schema";
import { GENERATE_DRAFT } from "@/jobs/handlers/generate-draft";
import type { Job } from "@/jobs/queue";
import { getStoryForUser, lockStoryForUser } from "./data";

export type RequestDraftResult =
  | { status: "queued"; job: Job }
  | { status: "already_running"; job: Job }
  | { status: "no_answers" };

const forStory = (storyId: string) =>
  and(
    eq(jobs.type, GENERATE_DRAFT),
    sql`${jobs.payload}->>'storyId' = ${storyId}`,
  );

/**
 * Asks for an LLM draft. This only inserts a row in `jobs` and returns at
 * once. A worker process does the slow part, so the draft still arrives if
 * the user closes the page.
 *
 * Returns null if the user does not own the story.
 */
export async function requestDraft(
  userId: string,
  storyId: string,
  now: Date = new Date(),
): Promise<RequestDraftResult | null> {
  return getDb().transaction(async (tx) => {
    const story = await lockStoryForUser(tx, userId, storyId);
    if (!story) return null;

    // One draft at a time per story. A second click while one is in flight
    // returns the job that is already there.
    const [active] = await tx
      .select()
      .from(jobs)
      .where(and(forStory(storyId), inArray(jobs.status, ["queued", "running"])))
      .limit(1);
    if (active) return { status: "already_running", job: active };

    const [answered] = await tx
      .select({ id: questionnaireAnswers.id })
      .from(questionnaireAnswers)
      .where(
        and(
          eq(questionnaireAnswers.storyId, storyId),
          eq(questionnaireAnswers.skipped, false),
        ),
      )
      .limit(1);
    if (!answered) return { status: "no_answers" };

    // The idempotency key names the version this draft is meant to become:
    // "the draft that follows version N". The same request repeated gives
    // the same key, and jobs.idempotency_key is UNIQUE.
    const [latest] = await tx
      .select({ versionNo: storyVersions.versionNo })
      .from(storyVersions)
      .where(eq(storyVersions.storyId, storyId))
      .orderBy(desc(storyVersions.versionNo))
      .limit(1);
    const idempotencyKey = `draft:${storyId}:v${(latest?.versionNo ?? 0) + 1}`;

    const [inserted] = await tx
      .insert(jobs)
      .values({
        type: GENERATE_DRAFT,
        payload: { storyId, userId },
        idempotencyKey,
        runAt: now,
      })
      .onConflictDoNothing({ target: jobs.idempotencyKey })
      .returning();
    if (inserted) return { status: "queued", job: inserted };

    // The key exists and the job is not active, so it failed earlier.
    // "Try again" reuses that row instead of adding a second job.
    const [requeued] = await tx
      .update(jobs)
      .set({
        status: "queued",
        attempts: 0,
        runAt: now,
        lockedAt: null,
        lastError: null,
      })
      .where(eq(jobs.idempotencyKey, idempotencyKey))
      .returning();
    return { status: "queued", job: requeued };
  });
}

/** The newest draft job for a story, or null. Null too if not the owner. */
export async function getLatestDraftJob(
  userId: string,
  storyId: string,
): Promise<Job | null> {
  const story = await getStoryForUser(userId, storyId);
  if (!story) return null;

  const [job] = await getDb()
    .select()
    .from(jobs)
    .where(forStory(story.id))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return job ?? null;
}

/**
 * Turns the stored error code into words for the user. The technical detail
 * stays in jobs.last_error for the developer.
 */
export function draftFailureMessage(job: Pick<Job, "status" | "lastError">): string | null {
  if (job.status !== "failed") return null;
  const code = job.lastError?.split(":")[0];
  switch (code) {
    case "COST_CAP":
      return "You have reached today's limit for AI drafts. Please try again tomorrow.";
    case "NO_ANSWERS":
      return "Answer at least one question first, then ask for a draft.";
    case "LLM_REFUSED":
      return "The AI could not write a draft from these answers. Try changing the wording of your answers.";
    default:
      return "We could not write your draft after several tries. Your answers are safe. Please try again.";
  }
}
