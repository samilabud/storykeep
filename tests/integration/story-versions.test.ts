import { beforeEach, describe, expect, it } from "vitest";
import { createStory, getStoryForUser } from "@/stories/data";
import {
  getVersion,
  listVersions,
  restoreVersion,
  saveVersion,
} from "@/stories/versions";
import { createTestUser, resetDb } from "../helpers/db";

describe("story version history", () => {
  let alice: { id: string };
  let bob: { id: string };
  let storyId: string;

  const edit = (content: string) =>
    saveVersion(alice.id, storyId, { source: "user_edit", content });

  beforeEach(async () => {
    await resetDb();
    alice = await createTestUser("alice@example.com");
    bob = await createTestUser("bob@example.com");
    storyId = (
      await createStory(alice.id, { title: "Grandpa Joe", kind: "life_story" })
    ).id;
  });

  it("numbers versions 1, 2, 3 and points the story at the newest", async () => {
    await edit("first");
    await edit("second");
    const third = await edit("third");

    expect(third?.version.versionNo).toBe(3);
    const story = await getStoryForUser(alice.id, storyId);
    expect(story?.currentVersionId).toBe(third?.version.id);
  });

  it("keeps every earlier version readable", async () => {
    await edit("first");
    await edit("second");

    const versions = await listVersions(alice.id, storyId);
    expect(versions?.map((v) => [v.versionNo, v.content])).toEqual([
      [2, "second"],
      [1, "first"],
    ]);
  });

  it("keeps LLM drafts and user edits in the same history", async () => {
    await saveVersion(alice.id, storyId, {
      source: "llm_draft",
      content: "Draft by the model.",
      idempotencyKey: `story:${storyId}:draft:1`,
    });
    await edit("Draft by the model, fixed by me.");

    const versions = await listVersions(alice.id, storyId);
    expect(versions?.map((v) => v.source)).toEqual(["user_edit", "llm_draft"]);
  });

  it("does not create a version when the text did not change", async () => {
    await edit("same text");
    const again = await edit("same text");

    expect(again?.status).toBe("unchanged");
    expect(await listVersions(alice.id, storyId)).toHaveLength(1);
  });

  it("restores an old version as a new version", async () => {
    await edit("first");
    await edit("second");

    const restored = await restoreVersion(alice.id, storyId, 1);
    expect(restored?.version).toMatchObject({ versionNo: 3, content: "first" });

    // Nothing was deleted: version 2 is still there.
    expect((await getVersion(alice.id, storyId, 2))?.content).toBe("second");
    const story = await getStoryForUser(alice.id, storyId);
    expect(story?.currentVersionId).toBe(restored?.version.id);
  });

  it("gives concurrent saves different version numbers", async () => {
    const results = await Promise.all(
      ["a", "b", "c", "d", "e"].map((content) => edit(content)),
    );
    const numbers = results.map((r) => r!.version.versionNo).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not let another user add, list, read or restore versions", async () => {
    await edit("private text");

    expect(
      await saveVersion(bob.id, storyId, { source: "user_edit", content: "x" }),
    ).toBeNull();
    expect(await listVersions(bob.id, storyId)).toBeNull();
    expect(await getVersion(bob.id, storyId, 1)).toBeNull();
    expect(await restoreVersion(bob.id, storyId, 1)).toBeNull();

    expect(await listVersions(alice.id, storyId)).toHaveLength(1);
  });
});
