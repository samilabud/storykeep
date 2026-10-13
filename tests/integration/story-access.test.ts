import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStory, getStoryForUser, listStoriesForUser } from "@/stories/data";
import { createTestUser, resetDb } from "../helpers/db";

// The session is the only thing we fake. The database, the queries and the
// route handler are real.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/auth/session", () => ({
  getSession: async () =>
    session.userId ? { user: { id: session.userId } } : null,
}));

import { GET } from "@/app/api/stories/[id]/route";

function callRoute(storyId: string) {
  return GET(new Request(`http://localhost/api/stories/${storyId}`), {
    params: Promise.resolve({ id: storyId }),
  });
}

describe("per-user access control for stories", () => {
  let alice: { id: string };
  let bob: { id: string };
  let bobsStoryId: string;

  beforeEach(async () => {
    await resetDb();
    alice = await createTestUser("alice@example.com");
    bob = await createTestUser("bob@example.com");
    const story = await createStory(bob.id, {
      title: "Bob's grandmother",
      kind: "life_story",
    });
    bobsStoryId = story.id;
    session.userId = null;
  });

  describe("data layer", () => {
    it("lets the owner read their own story", async () => {
      const story = await getStoryForUser(bob.id, bobsStoryId);
      expect(story?.title).toBe("Bob's grandmother");
    });

    it("does not let user A read user B's story", async () => {
      expect(await getStoryForUser(alice.id, bobsStoryId)).toBeNull();
    });

    it("does not list user B's stories for user A", async () => {
      expect(await listStoriesForUser(alice.id)).toEqual([]);
      expect(await listStoriesForUser(bob.id)).toHaveLength(1);
    });

    it("treats a malformed id as not found instead of crashing", async () => {
      expect(await getStoryForUser(alice.id, "not-a-uuid")).toBeNull();
    });
  });

  describe("GET /api/stories/:id", () => {
    it("returns 200 with the story for its owner", async () => {
      session.userId = bob.id;
      const res = await callRoute(bobsStoryId);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ title: "Bob's grandmother" });
    });

    it("returns 404 when user A asks for user B's story", async () => {
      session.userId = alice.id;
      const res = await callRoute(bobsStoryId);
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("grandmother");
    });

    it("gives the same 404 for a story that does not exist", async () => {
      session.userId = alice.id;
      const res = await callRoute("00000000-0000-4000-8000-000000000000");
      expect(res.status).toBe(404);
    });

    it("returns 401 when nobody is signed in", async () => {
      const res = await callRoute(bobsStoryId);
      expect(res.status).toBe(401);
    });
  });
});
