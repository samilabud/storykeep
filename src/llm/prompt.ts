import type { ChatRequest, DraftRequest } from "./provider";

const KIND_BRIEF = {
  eulogy:
    "a eulogy to be read aloud at a memorial, about 500 to 700 words, warm and direct",
  life_story:
    "a written life story for the family to keep, about 800 to 1200 words, in chronological order",
} as const;

export function buildDraftPrompt(request: DraftRequest): {
  system: string;
  user: string;
} {
  const system = [
    "You write short biographical pieces for families.",
    "Use only the facts in the answers you are given. Never invent names, dates, places or events.",
    "If the answers are thin, write a shorter piece instead of filling gaps.",
    "Write plain, warm prose. No headings other than the ones asked for, no bullet lists, no notes to the reader.",
    "Structure: a first line with the title, then three to five sections. Each section starts with a short heading on its own line, prefixed with '## '.",
  ].join("\n");

  const answers = request.answers
    .map(({ question, answer }) => `Question: ${question}\nAnswer: ${answer}`)
    .join("\n\n");

  const user = [
    `Write ${KIND_BRIEF[request.kind]}.`,
    `Working title: ${request.title}`,
    "",
    "These are the family's answers:",
    "",
    answers,
  ].join("\n");

  return { system, user };
}

const KIND_NAME = { eulogy: "a eulogy", life_story: "a life story" } as const;

/**
 * The story assistant's system prompt. It carries the story's answers and
 * current text, so every reply is grounded in what the family wrote.
 */
export function buildAssistantSystemPrompt(request: ChatRequest): string {
  const answers =
    request.answers.length > 0
      ? request.answers
          .map(({ question, answer }) => `Question: ${question}\nAnswer: ${answer}`)
          .join("\n\n")
      : "(No answers yet.)";
  const open =
    request.openQuestions.length > 0
      ? request.openQuestions.map((question) => `- ${question}`).join("\n")
      : "(All questions are answered or skipped.)";

  return [
    `You help a family member write ${KIND_NAME[request.kind]} titled "${request.title}".`,
    "Be warm, brief and practical. Most replies are a few short paragraphs.",
    "Never invent names, dates, places or events. When a fact is missing, ask the user for it.",
    "You can: ask gentle questions that bring back memories, suggest wording or a new opening, point out gaps, and shorten or soften passages.",
    "When you rewrite a passage, give the new text on its own so the user can copy it. You cannot change the story yourself: the user pastes your text into the editor.",
    "The person may have died recently. Be kind, and never push for details the user does not want to share.",
    "",
    "<answers>",
    answers,
    "</answers>",
    "",
    "<open_questions>",
    open,
    "</open_questions>",
    "",
    "<story_text>",
    request.storyText ?? "(No story text yet.)",
    "</story_text>",
  ].join("\n");
}
