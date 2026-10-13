// The questionnaire is fixed in code. Answers are stored by `key`, so the
// wording of a question can change without touching saved answers.

export type Question = { key: string; label: string; hint: string };

export const QUESTIONS: readonly Question[] = [
  {
    key: "full_name",
    label: "What is their full name, and what did people call them?",
    hint: "For example: Margaret Ellis, known to everyone as Maggie.",
  },
  {
    key: "origins",
    label: "Where and when were they born, and what was their family like?",
    hint: "Place, year, parents, brothers and sisters.",
  },
  {
    key: "childhood",
    label: "What is a story from their childhood or youth?",
    hint: "One clear memory is better than a long list.",
  },
  {
    key: "work",
    label: "What work did they do, and what did it mean to them?",
    hint: "Jobs, a trade, caring for a family, volunteering.",
  },
  {
    key: "relationships",
    label: "Who were the most important people in their life?",
    hint: "Partner, children, friends. How did they meet?",
  },
  {
    key: "passions",
    label: "What did they love to do?",
    hint: "Hobbies, music, food, places, teams.",
  },
  {
    key: "character",
    label: "How would you describe their character?",
    hint: "Three or four words, and a moment that shows it.",
  },
  {
    key: "hard_times",
    label: "What hard time did they come through?",
    hint: "Skip this one if you prefer.",
  },
  {
    key: "legacy",
    label: "What should people remember about them?",
    hint: "A saying, a lesson, or what you will miss most.",
  },
];

const KEYS = new Set(QUESTIONS.map((q) => q.key));

export function isQuestionKey(key: string): boolean {
  return KEYS.has(key);
}

/**
 * Save-and-resume: the first question that has no saved row yet.
 * A skipped question has a row, so it counts as handled.
 * Returns null when every question is answered or skipped.
 */
export function nextQuestionKey(handledKeys: Iterable<string>): string | null {
  const handled = new Set(handledKeys);
  return QUESTIONS.find((q) => !handled.has(q.key))?.key ?? null;
}
