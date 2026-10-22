import type { ChatRequest, ChatTurn } from "@/llm/provider";
import { getCurrentAnswers } from "@/questionnaire/data";
import { QUESTIONS } from "@/questionnaire/questions";
import { getStoryForUser } from "./data";
import { listVersions } from "./versions";

/**
 * Everything the story assistant knows about one story: the answers, the
 * questions still open and the current text. Null if the user does not own
 * the story.
 */
export async function buildChatRequest(
  userId: string,
  storyId: string,
  turns: ChatTurn[],
): Promise<ChatRequest | null> {
  const story = await getStoryForUser(userId, storyId);
  if (!story) return null;

  const [answers, versions] = await Promise.all([
    getCurrentAnswers(userId, story.id),
    listVersions(userId, story.id),
  ]);
  const current = versions?.find((v) => v.id === story.currentVersionId);

  const answered: ChatRequest["answers"] = [];
  const openQuestions: string[] = [];
  for (const question of QUESTIONS) {
    const answer = answers?.get(question.key);
    if (answer && !answer.skipped && answer.answerText) {
      answered.push({ question: question.label, answer: answer.answerText });
    } else if (!answer) {
      // A skipped question was a choice. Only unanswered ones are open.
      openQuestions.push(question.label);
    }
  }

  return {
    kind: story.kind,
    title: story.title,
    answers: answered,
    openQuestions,
    storyText: current?.content ?? null,
    turns,
  };
}
