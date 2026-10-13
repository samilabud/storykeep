"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { requireUser } from "@/auth/guards";
import { createStory } from "@/stories/data";

const newStorySchema = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(["eulogy", "life_story"]),
});

export async function createStoryAction(formData: FormData) {
  // A Server Action is a public endpoint. It checks the session itself and
  // takes the user id from the session, never from the form.
  const userId = await requireUser();

  const parsed = newStorySchema.safeParse({
    title: formData.get("title"),
    kind: formData.get("kind"),
  });
  if (!parsed.success) return;

  const story = await createStory(userId, parsed.data);
  redirect(`/stories/${story.id}`);
}
