import type { DraftRequest } from "./provider";

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
