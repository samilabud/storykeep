import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { questionnaireAnswers } from "@/db/schema";
import { getStoryForUser, lockStoryForUser } from "@/stories/data";
import { isQuestionKey } from "./questions";

// Answers are append-only. Changing an answer inserts a new row with
// revision + 1. The newest revision is the current answer, and older rows are
// the history. Nothing is ever updated or deleted.

export type Answer = typeof questionnaireAnswers.$inferSelect;

export type SaveAnswerInput = {
  questionKey: string;
  /** Empty or missing text together with `skipped: false` is saved as a skip. */
  answerText?: string | null;
  skipped?: boolean;
};

export type SaveAnswerResult =
  | { status: "saved"; answer: Answer }
  | { status: "unchanged"; answer: Answer };

/**
 * Saves one answer. Returns null if the user does not own the story.
 * Saving the same value again does nothing, so the history holds real
 * changes only.
 */
export async function saveAnswer(
  userId: string,
  storyId: string,
  input: SaveAnswerInput,
): Promise<SaveAnswerResult | null> {
  if (!isQuestionKey(input.questionKey)) {
    throw new Error(`Unknown question: ${input.questionKey}`);
  }
  const text = input.answerText?.trim() ?? "";
  const skipped = input.skipped === true || text === "";
  const answerText = skipped ? null : text;

  return getDb().transaction(async (tx) => {
    const story = await lockStoryForUser(tx, userId, storyId);
    if (!story) return null;

    const [latest] = await tx
      .select()
      .from(questionnaireAnswers)
      .where(
        and(
          eq(questionnaireAnswers.storyId, storyId),
          eq(questionnaireAnswers.questionKey, input.questionKey),
        ),
      )
      .orderBy(desc(questionnaireAnswers.revision))
      .limit(1);

    if (
      latest &&
      latest.skipped === skipped &&
      latest.answerText === answerText
    ) {
      return { status: "unchanged", answer: latest };
    }

    const [answer] = await tx
      .insert(questionnaireAnswers)
      .values({
        storyId,
        questionKey: input.questionKey,
        answerText,
        skipped,
        revision: (latest?.revision ?? 0) + 1,
      })
      .returning();
    return { status: "saved", answer };
  });
}

/**
 * The newest revision of each question, keyed by question key.
 * Returns null if the user does not own the story.
 */
export async function getCurrentAnswers(
  userId: string,
  storyId: string,
): Promise<Map<string, Answer> | null> {
  const rows = await ownedAnswers(userId, storyId);
  if (!rows) return null;

  // Rows come newest first, so the first one seen per question wins.
  const current = new Map<string, Answer>();
  for (const row of rows) {
    if (!current.has(row.questionKey)) current.set(row.questionKey, row);
  }
  return current;
}

/** Every revision of one question, newest first. Null if not the owner. */
export async function getAnswerHistory(
  userId: string,
  storyId: string,
  questionKey: string,
): Promise<Answer[] | null> {
  const rows = await ownedAnswers(userId, storyId);
  return rows ? rows.filter((row) => row.questionKey === questionKey) : null;
}

// One questionnaire is at most a few dozen small rows, so reading all of them
// and filtering in code is simpler than two special queries.
async function ownedAnswers(
  userId: string,
  storyId: string,
): Promise<Answer[] | null> {
  const story = await getStoryForUser(userId, storyId);
  if (!story) return null;

  return getDb()
    .select()
    .from(questionnaireAnswers)
    .where(eq(questionnaireAnswers.storyId, story.id))
    .orderBy(desc(questionnaireAnswers.revision));
}
