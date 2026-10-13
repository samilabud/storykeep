import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { jobs, llmUsage } from "@/db/schema";
import {
  createGenerateDraftHandler,
  GENERATE_DRAFT,
} from "@/jobs/handlers/generate-draft";
import { backoffMs, claimNextJob, STALE_LOCK_MS } from "@/jobs/queue";
import { runNextJob } from "@/jobs/worker";
import { spentTodayCents } from "@/llm/cost-cap";
import { MockLlmProvider } from "@/llm/mock";
import { LlmError } from "@/llm/provider";
import { saveAnswer } from "@/questionnaire/data";
import { createStory, getStoryForUser } from "@/stories/data";
import {
  draftFailureMessage,
  getLatestDraftJob,
  requestDraft,
} from "@/stories/drafts";
import { listVersions, saveVersion } from "@/stories/versions";
import { createTestUser, resetDb } from "../helpers/db";

const T0 = new Date("2026-10-13T10:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

describe("LLM draft in a background job", () => {
  let alice: { id: string };
  let bob: { id: string };
  let storyId: string;

  const handlersFor = (llm: MockLlmProvider) => ({
    [GENERATE_DRAFT]: createGenerateDraftHandler(llm),
  });
  const getJob = async (id: string) =>
    (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0];
  const drafts = async () =>
    (await listVersions(alice.id, storyId))!.filter((v) => v.source === "llm_draft");

  beforeEach(async () => {
    await resetDb();
    alice = await createTestUser("alice@example.com");
    bob = await createTestUser("bob@example.com");
    storyId = (
      await createStory(alice.id, { title: "Grandpa Joe", kind: "life_story" })
    ).id;
    await saveAnswer(alice.id, storyId, {
      questionKey: "full_name",
      answerText: "Joseph Ellis",
    });
  });

  describe("happy path", () => {
    it("the request only queues a job, and the worker writes the draft later", async () => {
      const llm = new MockLlmProvider();
      const requested = await requestDraft(alice.id, storyId, T0);
      expect(requested).toMatchObject({ status: "queued" });

      // Nothing has run yet: no LLM call, no draft.
      expect(llm.calls).toBe(0);
      expect(await drafts()).toHaveLength(0);

      const run = await runNextJob(handlersFor(llm), T0);
      expect(run?.status).toBe("succeeded");

      const [draft] = await drafts();
      expect(draft.content).toContain("Joseph Ellis");
      const story = await getStoryForUser(alice.id, storyId);
      expect(story?.currentVersionId).toBe(draft.id);
    });

    it("records token usage and cost for the call", async () => {
      await requestDraft(alice.id, storyId, T0);
      await runNextJob(handlersFor(new MockLlmProvider({ costCents: 7 })), T0);

      const [usage] = await getDb().select().from(llmUsage);
      expect(usage).toMatchObject({
        userId: alice.id,
        provider: "mock",
        costCents: 7,
        day: "2026-10-13",
      });
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(await spentTodayCents(alice.id, T0)).toBe(7);
    });
  });

  describe("no duplicate jobs", () => {
    it("two clicks give one job", async () => {
      const first = await requestDraft(alice.id, storyId, T0);
      const second = await requestDraft(alice.id, storyId, T0);

      expect(second).toMatchObject({ status: "already_running" });
      expect((second as { job: { id: string } }).job.id).toBe(
        (first as { job: { id: string } }).job.id,
      );
      expect(await getDb().select().from(jobs)).toHaveLength(1);
    });

    it("five requests at the same moment give one job", async () => {
      await Promise.all(
        Array.from({ length: 5 }, () => requestDraft(alice.id, storyId, T0)),
      );
      expect(await getDb().select().from(jobs)).toHaveLength(1);
    });

    it("two workers never claim the same job", async () => {
      await requestDraft(alice.id, storyId, T0);
      const claims = await Promise.all([
        claimNextJob(T0),
        claimNextJob(T0),
        claimNextJob(T0),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("retries are idempotent", () => {
    it("a job that fails once and is retried creates exactly one version", async () => {
      const llm = new MockLlmProvider({ failTimes: 1 });
      const requested = await requestDraft(alice.id, storyId, T0);
      const jobId = (requested as { job: { id: string } }).job.id;

      const first = await runNextJob(handlersFor(llm), T0);
      expect(first?.status).toBe("queued"); // back in the queue, not failed
      expect(await drafts()).toHaveLength(0);

      // Not ready yet: the retry waits for the backoff delay.
      expect(await runNextJob(handlersFor(llm), later(1000))).toBeNull();

      const second = await runNextJob(handlersFor(llm), later(backoffMs(1)));
      expect(second?.status).toBe("succeeded");
      expect(await drafts()).toHaveLength(1);
      expect((await getJob(jobId)).attempts).toBe(2);
    });

    it("a worker that dies after saving the draft does not create a second one", async () => {
      const llm = new MockLlmProvider();
      await requestDraft(alice.id, storyId, T0);

      // Worker 1 claims the job, saves the draft, then "crashes" before it
      // can mark the job as succeeded.
      const job = (await claimNextJob(T0))!;
      await createGenerateDraftHandler(llm)(job, T0);
      expect(await drafts()).toHaveLength(1);
      expect((await getJob(job.id)).status).toBe("running");

      // Too early: the job still looks alive, so nobody else takes it.
      expect(await runNextJob(handlersFor(llm), later(60_000))).toBeNull();

      // After the lock is stale, worker 2 takes the job and runs it again.
      const rerun = await runNextJob(handlersFor(llm), later(STALE_LOCK_MS + 1));
      expect(rerun?.status).toBe("succeeded");

      expect(await drafts()).toHaveLength(1); // still one draft
      expect(llm.calls).toBe(1); // and no second paid call
      expect(await getDb().select().from(llmUsage)).toHaveLength(1);
    });

    it("the same handler run twice at once still saves one draft", async () => {
      const llm = new MockLlmProvider({ delayMs: 20 });
      await requestDraft(alice.id, storyId, T0);
      const job = (await claimNextJob(T0))!;
      const handler = createGenerateDraftHandler(llm);

      // Both runs pass the "already done?" check, both call the model, and
      // both try to save. The idempotency key lets only one row in.
      await Promise.all([handler(job, T0), handler(job, T0)]);

      expect(llm.calls).toBe(2);
      expect(await drafts()).toHaveLength(1);
    });

    it("a second draft after the first is a new job and a new version", async () => {
      const llm = new MockLlmProvider();
      await requestDraft(alice.id, storyId, T0);
      await runNextJob(handlersFor(llm), T0);

      const again = await requestDraft(alice.id, storyId, T0);
      expect(again).toMatchObject({ status: "queued" });
      await runNextJob(handlersFor(llm), T0);

      expect((await drafts()).map((v) => v.versionNo)).toEqual([2, 1]);
    });

    it("a user edit made while the job waits is kept in the history", async () => {
      await requestDraft(alice.id, storyId, T0);
      await saveVersion(alice.id, storyId, {
        source: "user_edit",
        content: "My own words.",
      });
      await runNextJob(handlersFor(new MockLlmProvider()), T0);

      const versions = await listVersions(alice.id, storyId);
      expect(versions?.map((v) => [v.versionNo, v.source])).toEqual([
        [2, "llm_draft"],
        [1, "user_edit"],
      ]);
    });
  });

  describe("failures", () => {
    it("a failing LLM is retried, then marked failed with a clear message", async () => {
      const llm = new MockLlmProvider({ failTimes: 99 });
      const requested = await requestDraft(alice.id, storyId, T0);
      const jobId = (requested as { job: { id: string } }).job.id;
      const handlers = handlersFor(llm);

      // Three tries, each after a longer wait: +0s, +5s, +5s+10s.
      const statuses = [
        (await runNextJob(handlers, T0))?.status,
        (await runNextJob(handlers, later(5_000)))?.status,
        (await runNextJob(handlers, later(15_000)))?.status,
      ];
      expect(statuses).toEqual(["queued", "queued", "failed"]);
      expect(llm.calls).toBe(3);

      const job = await getJob(jobId);
      expect(job).toMatchObject({ status: "failed", attempts: 3 });
      expect(job.lastError).toBe("LLM_UNAVAILABLE: Mock model is overloaded");
      expect(draftFailureMessage(job)).toBe(
        "We could not write your draft after several tries. Your answers are safe. Please try again.",
      );

      // A failed job is finished. The worker does not pick it up again.
      expect(await runNextJob(handlers, later(3_600_000))).toBeNull();
      expect(await drafts()).toHaveLength(0);
    });

    it("an error that cannot be fixed by retrying fails at once", async () => {
      const llm = new MockLlmProvider({
        failTimes: 99,
        error: new LlmError("LLM_REFUSED", "The model declined", false),
      });
      await requestDraft(alice.id, storyId, T0);

      const run = await runNextJob(handlersFor(llm), T0);
      expect(run?.status).toBe("failed");
      expect(llm.calls).toBe(1);

      const job = await getLatestDraftJob(alice.id, storyId);
      expect(draftFailureMessage(job!)).toContain("could not write a draft from these answers");
    });

    it("'try again' after a failure reuses the same job row", async () => {
      await requestDraft(alice.id, storyId, T0);
      const refuse = new MockLlmProvider({
        failTimes: 1,
        error: new LlmError("LLM_REJECTED", "Bad request", false),
      });
      await runNextJob(handlersFor(refuse), T0);

      const retry = await requestDraft(alice.id, storyId, later(60_000));
      expect(retry).toMatchObject({ status: "queued", job: { attempts: 0 } });
      expect(await getDb().select().from(jobs)).toHaveLength(1);

      const run = await runNextJob(handlersFor(new MockLlmProvider()), later(60_000));
      expect(run?.status).toBe("succeeded");
      expect(await drafts()).toHaveLength(1);
    });
  });

  describe("daily cost cap", () => {
    it("blocks a draft once the user has spent the daily budget", async () => {
      // The default cap is 100 cents. Each mock call costs 60.
      const llm = new MockLlmProvider({ costCents: 60 });
      const handlers = handlersFor(llm);

      for (const expected of ["succeeded", "succeeded"]) {
        await requestDraft(alice.id, storyId, T0);
        expect((await runNextJob(handlers, T0))?.status).toBe(expected);
      }
      expect(await spentTodayCents(alice.id, T0)).toBe(120);

      // Third request: over the cap. Fails before any LLM call.
      await requestDraft(alice.id, storyId, T0);
      expect((await runNextJob(handlers, T0))?.status).toBe("failed");
      expect(llm.calls).toBe(2);

      const job = await getLatestDraftJob(alice.id, storyId);
      expect(job?.lastError).toMatch(/^COST_CAP:/);
      expect(draftFailureMessage(job!)).toBe(
        "You have reached today's limit for AI drafts. Please try again tomorrow.",
      );
    });

    it("resets the next day and does not count other users", async () => {
      const handlers = handlersFor(new MockLlmProvider({ costCents: 100 }));
      await requestDraft(alice.id, storyId, T0);
      await runNextJob(handlers, T0);

      expect(await spentTodayCents(alice.id, T0)).toBe(100);
      expect(await spentTodayCents(bob.id, T0)).toBe(0);

      const tomorrow = later(24 * 3_600_000);
      expect(await spentTodayCents(alice.id, tomorrow)).toBe(0);
      await requestDraft(alice.id, storyId, tomorrow);
      expect((await runNextJob(handlers, tomorrow))?.status).toBe("succeeded");
    });
  });

  describe("guards", () => {
    it("does not queue a draft when no question is answered", async () => {
      const empty = await createStory(alice.id, { title: "Empty", kind: "eulogy" });
      await saveAnswer(alice.id, empty.id, { questionKey: "work", skipped: true });

      expect(await requestDraft(alice.id, empty.id, T0)).toEqual({
        status: "no_answers",
      });
      expect(await getDb().select().from(jobs)).toHaveLength(0);
    });

    it("does not let another user request or see a draft job", async () => {
      expect(await requestDraft(bob.id, storyId, T0)).toBeNull();
      expect(await getDb().select().from(jobs)).toHaveLength(0);

      await requestDraft(alice.id, storyId, T0);
      expect(await getLatestDraftJob(bob.id, storyId)).toBeNull();
    });
  });
});
