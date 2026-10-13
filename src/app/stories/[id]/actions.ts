"use server";

import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth/guards";
import { saveAnswer } from "@/questionnaire/data";
import { isQuestionKey } from "@/questionnaire/questions";
import { requestDraft } from "@/stories/drafts";
import { restoreVersion, saveVersion } from "@/stories/versions";

// Each action reads the user from the session and passes it to the data
// layer. The data layer returns null when the story is not theirs.

const MAX_ANSWER_LENGTH = 4000;
const MAX_STORY_LENGTH = 50_000;

export async function saveAnswerAction(
  storyId: string,
  questionKey: string,
  formData: FormData,
) {
  const userId = await requireUser();
  if (!isQuestionKey(questionKey)) notFound();

  const skipped = formData.get("intent") === "skip";
  const answerText = String(formData.get("answer") ?? "").slice(
    0,
    MAX_ANSWER_LENGTH,
  );

  const result = await saveAnswer(userId, storyId, {
    questionKey,
    answerText: skipped ? null : answerText,
    skipped,
  });
  if (!result) notFound();

  // No ?q= in the URL: the page works out where to resume.
  redirect(`/stories/${storyId}/questionnaire`);
}

export async function saveStoryTextAction(storyId: string, formData: FormData) {
  const userId = await requireUser();
  const content = String(formData.get("content") ?? "")
    .trim()
    .slice(0, MAX_STORY_LENGTH);
  if (content === "") return;

  const result = await saveVersion(userId, storyId, {
    source: "user_edit",
    content,
  });
  if (!result) notFound();

  refresh();
}

export async function restoreVersionAction(storyId: string, versionNo: number) {
  const userId = await requireUser();
  const result = await restoreVersion(userId, storyId, versionNo);
  if (!result) notFound();

  redirect(`/stories/${storyId}`);
}

export async function requestDraftAction(storyId: string) {
  const userId = await requireUser();
  // This returns as soon as the job row is saved. The worker writes the draft.
  const result = await requestDraft(userId, storyId);
  if (!result) notFound();

  refresh();
}
