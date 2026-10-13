import { and, asc, eq, lt, lte, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";

// A small job queue on one Postgres table.
//
//   queued --claim--> running --ok--> succeeded
//      ^                 |
//      +--- retry later--+--no tries left / not retryable--> failed
//
// Delivery is "at least once": a job can run twice (a retry, or a worker that
// died halfway). So every handler must be idempotent. The queue does not make
// work happen once. It makes sure work is not forgotten.

export type Job = typeof jobs.$inferSelect;

/**
 * Thrown by handlers. `code` is stored and later turned into a message for
 * the user. `retryable: false` fails the job at once.
 */
export class JobError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JobError";
  }
}

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** A job "running" for longer than this is treated as a dead worker. */
export const STALE_LOCK_MS = 5 * 60_000;

/** Exponential backoff: 5s after the 1st failure, 10s after the 2nd, 20s... */
export function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

/**
 * Takes one job that is ready and marks it running. Returns null if there is
 * nothing to do.
 *
 * FOR UPDATE SKIP LOCKED is what makes several workers safe: a row another
 * worker is claiming is skipped, not waited on, so two workers never take the
 * same job.
 */
export async function claimNextJob(now: Date): Promise<Job | null> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);

  return getDb().transaction(async (tx) => {
    // Loop only to step over crashed jobs that have no tries left.
    for (;;) {
      const [candidate] = await tx
        .select()
        .from(jobs)
        .where(
          or(
            and(eq(jobs.status, "queued"), lte(jobs.runAt, now)),
            // A worker died while holding this job. Take it back.
            and(eq(jobs.status, "running"), lt(jobs.lockedAt, staleBefore)),
          ),
        )
        .orderBy(asc(jobs.runAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return null;

      if (candidate.attempts >= candidate.maxAttempts) {
        await tx
          .update(jobs)
          .set({
            status: "failed",
            lockedAt: null,
            lastError: "WORKER_CRASHED: the worker stopped during the last try",
          })
          .where(eq(jobs.id, candidate.id));
        continue;
      }

      const [claimed] = await tx
        .update(jobs)
        .set({
          status: "running",
          lockedAt: now,
          attempts: candidate.attempts + 1,
        })
        .where(eq(jobs.id, candidate.id))
        .returning();
      return claimed;
    }
  });
}

export async function markSucceeded(job: Job): Promise<void> {
  await getDb()
    .update(jobs)
    .set({ status: "succeeded", lockedAt: null, lastError: null })
    .where(eq(jobs.id, job.id));
}

/**
 * Records a failed try. The job goes back to the queue with a delay, or
 * becomes `failed` when the error is not retryable or no tries are left.
 */
export async function markFailedAttempt(
  job: Job,
  error: unknown,
  now: Date,
): Promise<Job["status"]> {
  const jobError =
    error instanceof JobError
      ? error
      : new JobError("UNEXPECTED", describe(error), true, { cause: error });

  const giveUp = !jobError.retryable || job.attempts >= job.maxAttempts;
  const status = giveUp ? "failed" : "queued";

  await getDb()
    .update(jobs)
    .set({
      status,
      lockedAt: null,
      lastError: `${jobError.code}: ${jobError.message}`,
      runAt: giveUp ? job.runAt : new Date(now.getTime() + backoffMs(job.attempts)),
    })
    .where(eq(jobs.id, job.id));
  return status;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
