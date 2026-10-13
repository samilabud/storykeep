import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { stories, storyVersions } from "@/db/schema";
import { getStoryForUser, lockStoryForUser } from "./data";

// The text of a story is never overwritten. Every save is a new row in
// story_versions with the next version number. stories.current_version_id
// points at the one the user sees. "Restore" is also just a new version.

export type StoryVersion = typeof storyVersions.$inferSelect;
export type VersionSource = StoryVersion["source"];

export type SaveVersionInput = {
  source: VersionSource;
  content: string;
  /** Used by LLM jobs in M3 so a retry cannot create a second draft. */
  idempotencyKey?: string;
};

export type SaveVersionResult =
  | { status: "created"; version: StoryVersion }
  | { status: "unchanged"; version: StoryVersion };

/**
 * Appends a version and makes it the current one.
 * Returns null if the user does not own the story.
 * A user edit with the same text as the current version does nothing.
 */
export async function saveVersion(
  userId: string,
  storyId: string,
  input: SaveVersionInput,
): Promise<SaveVersionResult | null> {
  return getDb().transaction(async (tx) => {
    // The row lock makes "read the highest number, then insert number + 1"
    // safe when two saves arrive together.
    const story = await lockStoryForUser(tx, userId, storyId);
    if (!story) return null;

    const [latest] = await tx
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.storyId, storyId))
      .orderBy(desc(storyVersions.versionNo))
      .limit(1);

    if (input.source === "user_edit" && story.currentVersionId) {
      const [current] = await tx
        .select()
        .from(storyVersions)
        .where(eq(storyVersions.id, story.currentVersionId));
      if (current && current.content === input.content) {
        return { status: "unchanged", version: current };
      }
    }

    const [version] = await tx
      .insert(storyVersions)
      .values({
        storyId,
        versionNo: (latest?.versionNo ?? 0) + 1,
        source: input.source,
        content: input.content,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();

    await tx
      .update(stories)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(stories.id, storyId));

    return { status: "created", version };
  });
}

/** All versions, newest first. Null if the user does not own the story. */
export async function listVersions(
  userId: string,
  storyId: string,
): Promise<StoryVersion[] | null> {
  const story = await getStoryForUser(userId, storyId);
  if (!story) return null;

  return getDb()
    .select()
    .from(storyVersions)
    .where(eq(storyVersions.storyId, story.id))
    .orderBy(desc(storyVersions.versionNo));
}

export async function getVersion(
  userId: string,
  storyId: string,
  versionNo: number,
): Promise<StoryVersion | null> {
  const story = await getStoryForUser(userId, storyId);
  if (!story || !Number.isInteger(versionNo)) return null;

  const [version] = await getDb()
    .select()
    .from(storyVersions)
    .where(
      and(
        eq(storyVersions.storyId, story.id),
        eq(storyVersions.versionNo, versionNo),
      ),
    );
  return version ?? null;
}

/**
 * Makes an old version current again by copying its text into a new version.
 * History only grows, so a restore can itself be undone.
 */
export async function restoreVersion(
  userId: string,
  storyId: string,
  versionNo: number,
): Promise<SaveVersionResult | null> {
  const old = await getVersion(userId, storyId, versionNo);
  if (!old) return null;
  return saveVersion(userId, storyId, {
    source: "user_edit",
    content: old.content,
  });
}
