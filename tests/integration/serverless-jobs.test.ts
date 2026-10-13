import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/jobs/route";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { runPendingJobs } from "@/jobs/run";
import { saveAnswer } from "@/questionnaire/data";
import { createStory } from "@/stories/data";
import { requestDraft } from "@/stories/drafts";
import { listVersions } from "@/stories/versions";
import { createTestUser, giveActiveSubscription, resetDb } from "../helpers/db";

// On a host with no worker process, the app itself drives the queue.
describe("running jobs without a worker process", () => {
  let userId: string;
  let storyId: string;

  const cron = (authorization?: string) =>
    GET(
      new Request("http://localhost/api/cron/jobs", {
        headers: authorization ? { authorization } : {},
      }),
    );

  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("LLM_PROVIDER", "mock");
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    const user = await createTestUser("alice@example.com");
    userId = user.id;
    await giveActiveSubscription(userId);
    storyId = (await createStory(userId, { title: "Aunt Rosa", kind: "life_story" })).id;
    await saveAnswer(userId, storyId, { questionKey: "full_name", answerText: "Rosa" });
  });

  it("runPendingJobs runs a queued draft and then finds nothing more", async () => {
    await requestDraft(userId, storyId);

    const results = await runPendingJobs();
    expect(results.map((r) => r.status)).toEqual(["succeeded"]);
    expect(await listVersions(userId, storyId)).toHaveLength(1);
    expect(await runPendingJobs()).toEqual([]);
  });

  it("two runs at the same moment do the job once", async () => {
    await requestDraft(userId, storyId);

    const [a, b] = await Promise.all([runPendingJobs(), runPendingJobs()]);
    expect(a.length + b.length).toBe(1);
    expect(await listVersions(userId, storyId)).toHaveLength(1);
  });

  it("the cron route runs waiting jobs when the secret is right", async () => {
    await requestDraft(userId, storyId);

    const response = await cron("Bearer test-cron-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ran: 1,
      results: [{ type: "generate_draft", status: "succeeded" }],
    });
  });

  it("the cron route refuses a missing or wrong secret and runs nothing", async () => {
    await requestDraft(userId, storyId);

    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer wrong")).status).toBe(401);
    const [job] = await getDb().select().from(jobs);
    expect(job.status).toBe("queued");
  });

  it("the cron route refuses everything when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron("Bearer ")).status).toBe(401);
  });
});
