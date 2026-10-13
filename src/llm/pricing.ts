// US dollars per one million tokens. Checked on 2026-10-13 against
// Anthropic's published prices. Update this table when prices change.
const PRICE_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

// A model we have no price for is billed at the highest known rate. The cost
// cap must never under-count.
const HIGHEST = { input: 10, output: 50 };

/**
 * Cost of one call in whole cents, rounded up. Rounding up means the daily
 * cap triggers slightly early, never late.
 */
export function costCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICE_PER_MILLION_TOKENS[model] ?? HIGHEST;
  const dollars =
    (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.ceil(dollars * 100);
}
