import { SEND_EMAIL } from "@/email/outbox";
import { getLlmProvider } from "@/llm/provider";
import {
  createGenerateDraftHandler,
  GENERATE_DRAFT,
} from "./handlers/generate-draft";
import { createMailer, createSendEmailHandler } from "./handlers/send-email";
import { runNextJob, type RunResult } from "./worker";

/**
 * Runs the jobs that are ready, a few at a time, then returns.
 *
 * Locally `pnpm worker` loops forever and calls the queue. A serverless host
 * such as Vercel cannot keep a process alive, so there the web app calls
 * this right after it queues a job, and a daily cron calls it as a safety
 * net. The queue itself is the same in both cases: rows in `jobs`, claimed
 * with SKIP LOCKED, safe to run from many places at once.
 */
export async function runPendingJobs(maxJobs = 5): Promise<RunResult[]> {
  const handlers = {
    [GENERATE_DRAFT]: createGenerateDraftHandler(await getLlmProvider()),
    [SEND_EMAIL]: createSendEmailHandler(createMailer()),
  };

  const results: RunResult[] = [];
  while (results.length < maxJobs) {
    const result = await runNextJob(handlers);
    if (!result) break;
    results.push(result);
  }
  return results;
}

/** For `after(...)`: never throws, because nobody is left to catch it. */
export async function runPendingJobsQuietly(): Promise<void> {
  try {
    const results = await runPendingJobs();
    for (const result of results) {
      console.log(`[jobs] ${result.type} ${result.jobId} -> ${result.status}`);
    }
  } catch (error) {
    console.error("[jobs] run failed:", error);
  }
}
