import { notFound, redirect } from "next/navigation";
import { getStoryForUser } from "@/stories/data";
import { getSession } from "./session";

/** The logged-in user's id, or null. Does not redirect. Use in Route Handlers. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.user?.id ?? null;
}

/** For pages and Server Actions: sends anonymous visitors to /login. */
export async function requireUser(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return userId;
}

/**
 * Returns the story only if the logged-in user owns it.
 * Someone else's story gives the same "not found" as a story that does not
 * exist, so a stranger cannot learn which ids are real.
 */
export async function requireStoryOwner(storyId: string) {
  const userId = await requireUser();
  const story = await getStoryForUser(userId, storyId);
  if (!story) notFound();
  return story;
}
