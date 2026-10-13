import { and, desc, eq } from "drizzle-orm";
import * as z from "zod";
import { getDb, type Db } from "@/db/client";
import { stories } from "@/db/schema";

// Data access for stories. Every function takes the user id and puts it in
// the WHERE clause. There is no "get story by id only" function on purpose:
// that is how access control stays impossible to forget.

export type Story = typeof stories.$inferSelect;
export type StoryKind = Story["kind"];

const uuidSchema = z.uuid();

export async function listStoriesForUser(userId: string): Promise<Story[]> {
  return getDb()
    .select()
    .from(stories)
    .where(eq(stories.userId, userId))
    .orderBy(desc(stories.createdAt));
}

export async function getStoryForUser(
  userId: string,
  storyId: string,
): Promise<Story | null> {
  // A malformed id would make Postgres throw. Treat it as "not found".
  if (!uuidSchema.safeParse(storyId).success) return null;

  const [story] = await getDb()
    .select()
    .from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.userId, userId)))
    .limit(1);
  return story ?? null;
}

export async function createStory(
  userId: string,
  input: { title: string; kind: StoryKind },
): Promise<Story> {
  const [story] = await getDb()
    .insert(stories)
    .values({ userId, title: input.title, kind: input.kind })
    .returning();
  return story;
}

/** The handle Drizzle gives you inside `db.transaction(...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Inside a transaction: load the story if this user owns it, and lock its row
 * until the transaction ends (SELECT ... FOR UPDATE).
 *
 * The lock makes writes to one story wait in line. Two saves at the same time
 * cannot both read "latest version is 3" and both try to write version 4.
 */
export async function lockStoryForUser(
  tx: Tx,
  userId: string,
  storyId: string,
): Promise<Story | null> {
  if (!uuidSchema.safeParse(storyId).success) return null;

  const [story] = await tx
    .select()
    .from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.userId, userId)))
    .for("update");
  return story ?? null;
}
