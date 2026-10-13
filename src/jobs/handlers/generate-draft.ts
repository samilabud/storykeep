import * as z from "zod";
import { isOverDailyCap, recordUsage } from "@/llm/cost-cap";
import { LlmError, type LlmProvider } from "@/llm/provider";
import { getCurrentAnswers } from "@/questionnaire/data";
import { QUESTIONS } from "@/questionnaire/questions";
import { getStoryForUser } from "@/stories/data";
import { getVersionByIdempotencyKey, saveVersion } from "@/stories/versions";
import { JobError } from "../queue";
import type { JobHandler } from "../worker";

export const GENERATE_DRAFT = "generate_draft";

const payloadSchema = z.object({ storyId: z.uuid(), userId: z.uuid() });

/**
 * Writes one LLM draft for a story as a new version.
 *
 * This can run more than once for the same job (a retry, or a crashed
 * worker). It stays safe because the draft is saved with the job's
 * idempotency key, and story_versions.idempotency_key is UNIQUE. A second
 * run finds the existing draft and stops.
 */
export function createGenerateDraftHandler(llm: LlmProvider): JobHandler {
  return async (job, now) => {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new JobError("BAD_PAYLOAD", "Job payload is not valid", false);
    }
    const { storyId, userId } = parsed.data;

    const story = await getStoryForUser(userId, storyId);
    if (!story) throw new JobError("STORY_GONE", "Story not found", false);

    // 1. Already done by an earlier run? Then do not pay for a second call.
    if (await getVersionByIdempotencyKey(userId, storyId, job.idempotencyKey)) {
      return;
    }

    // 2. Check the budget before spending.
    if (await isOverDailyCap(userId, now)) {
      throw new JobError("COST_CAP", "Daily LLM budget reached", false);
    }

    const current = await getCurrentAnswers(userId, storyId);
    const answers = QUESTIONS.flatMap((question) => {
      const answer = current?.get(question.key);
      return answer?.answerText
        ? [{ question: question.label, answer: answer.answerText }]
        : [];
    });
    if (answers.length === 0) {
      throw new JobError("NO_ANSWERS", "No answered questions", false);
    }

    // 3. The slow, paid, unreliable step.
    let draft;
    try {
      draft = await llm.generateDraft({
        kind: story.kind,
        title: story.title,
        answers,
      });
    } catch (error) {
      if (error instanceof LlmError) {
        throw new JobError(error.code, error.message, error.retryable, {
          cause: error,
        });
      }
      throw error;
    }

    // 4. The call returned, so money was spent. Record it even if the next
    //    step fails. The usage table should match the provider's invoice.
    await recordUsage(userId, job.id, draft, now);

    // 5. Save. If another run saved first, this returns the existing draft
    //    and inserts nothing.
    await saveVersion(userId, storyId, {
      source: "llm_draft",
      content: draft.text,
      idempotencyKey: job.idempotencyKey,
    });
  };
}
