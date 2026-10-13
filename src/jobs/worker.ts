import {
  claimNextJob,
  JobError,
  markFailedAttempt,
  markSucceeded,
  type Job,
} from "./queue";

export type JobHandler = (job: Job, now: Date) => Promise<void>;
export type JobHandlers = Record<string, JobHandler>;

export type RunResult = { jobId: string; type: string; status: Job["status"] };

/**
 * Claims one ready job and runs it. Returns null when the queue is idle.
 * `now` is a parameter so tests can move time forward without sleeping.
 */
export async function runNextJob(
  handlers: JobHandlers,
  now: Date = new Date(),
): Promise<RunResult | null> {
  const job = await claimNextJob(now);
  if (!job) return null;

  try {
    const handler = handlers[job.type];
    if (!handler) {
      throw new JobError("UNKNOWN_JOB_TYPE", `No handler for ${job.type}`, false);
    }
    await handler(job, now);
    await markSucceeded(job);
    return { jobId: job.id, type: job.type, status: "succeeded" };
  } catch (error) {
    const status = await markFailedAttempt(job, error, now);
    return { jobId: job.id, type: job.type, status };
  }
}
