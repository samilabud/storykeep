// One real call to the Anthropic API, to check the key and see a real draft.
// This spends a few cents. Run it yourself:  pnpm llm:smoke
// Needs ANTHROPIC_API_KEY in .env.local. Nothing is saved to the database.

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set in .env.local");
    process.exit(1);
  }
  const { AnthropicLlmProvider } = await import("@/llm/anthropic");

  const result = await new AnthropicLlmProvider().generateDraft({
    kind: "eulogy",
    title: "Grandpa Joe",
    answers: [
      {
        question: "What is their full name, and what did people call them?",
        answer: "Joseph Ellis. Everyone called him Joe.",
      },
      {
        question: "What work did they do, and what did it mean to them?",
        answer: "He was a carpenter for forty years. He built half the porches on our street.",
      },
    ],
  });

  console.log(result.text);
  console.log("\n---");
  console.log(
    `model=${result.model} input_tokens=${result.inputTokens} ` +
      `output_tokens=${result.outputTokens} cost_cents=${result.costCents}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
