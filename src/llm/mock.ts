import {
  LlmError,
  type DraftRequest,
  type DraftResult,
  type LlmProvider,
} from "./provider";

type MockOptions = {
  /** Fail this many calls before succeeding. Used to test retries. */
  failTimes?: number;
  /** The error thrown while failing. Default: a retryable outage. */
  error?: LlmError;
  /** Wait before answering, to imitate a slow model. */
  delayMs?: number;
  /** Cost reported per call. Used to test the daily cap. */
  costCents?: number;
};

/**
 * A fake model. It builds a draft from the answers with no network call, so
 * the same input always gives the same text.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";
  /** How many times generateDraft was called, including failed calls. */
  calls = 0;
  private failuresLeft: number;

  constructor(private readonly options: MockOptions = {}) {
    this.failuresLeft = options.failTimes ?? 0;
  }

  async generateDraft(request: DraftRequest): Promise<DraftResult> {
    this.calls += 1;
    if (this.options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw (
        this.options.error ??
        new LlmError("LLM_UNAVAILABLE", "Mock model is overloaded", true)
      );
    }

    const sections = request.answers.map(
      ({ question, answer }) => `## ${question}\n\n${answer}`,
    );
    const text = [
      request.title,
      "",
      `[Mock ${request.kind === "eulogy" ? "eulogy" : "life story"} draft]`,
      "",
      ...sections,
    ].join("\n");

    return {
      text,
      provider: this.name,
      model: "mock-1",
      inputTokens: Math.ceil(JSON.stringify(request).length / 4),
      outputTokens: Math.ceil(text.length / 4),
      costCents: this.options.costCents ?? 1,
    };
  }
}
