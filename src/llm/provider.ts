// The rest of the app talks to this interface only. Which provider is behind
// it is chosen by LLM_PROVIDER, so tests run offline and cost nothing.

export type DraftRequest = {
  kind: "eulogy" | "life_story";
  title: string;
  /** Only answered questions. Skipped ones are left out. */
  answers: { question: string; answer: string }[];
};

export type DraftResult = {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  kind: "eulogy" | "life_story";
  title: string;
  /** Only answered questions. Skipped ones are left out. */
  answers: { question: string; answer: string }[];
  /** Questions with no answer yet, so the assistant can help fill them. */
  openQuestions: string[];
  /** The current story text, or null before the first version. */
  storyText: string | null;
  /** The whole conversation so far. The last turn is the user's. */
  turns: ChatTurn[];
};

/** Same shape as a draft: the full reply text plus what it cost. */
export type ChatResult = DraftResult;

export interface LlmProvider {
  readonly name: string;
  generateDraft(request: DraftRequest): Promise<DraftResult>;
  /**
   * Streams one assistant reply. `onText` gets each piece as it arrives.
   * The promise resolves with the whole reply once the model is done.
   */
  streamChat(
    request: ChatRequest,
    onText: (text: string) => void,
  ): Promise<ChatResult>;
}

/**
 * Every provider turns its own errors into this one. `retryable` tells the
 * job queue what to do: a rate limit is worth another try, a bad API key or a
 * refusal is not.
 */
export class LlmError extends Error {
  constructor(
    readonly code: "LLM_UNAVAILABLE" | "LLM_REJECTED" | "LLM_REFUSED",
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LlmError";
  }
}

export async function getLlmProvider(): Promise<LlmProvider> {
  const name = process.env.LLM_PROVIDER ?? "mock";
  if (name === "mock") {
    const { MockLlmProvider } = await import("./mock");
    return new MockLlmProvider({
      delayMs: Number(process.env.MOCK_LLM_DELAY_MS ?? 0),
    });
  }
  if (name === "anthropic") {
    // Imported only when used, so the mock path never loads the SDK.
    const { AnthropicLlmProvider } = await import("./anthropic");
    return new AnthropicLlmProvider();
  }
  throw new Error(`Unknown LLM_PROVIDER: ${name}. Use "mock" or "anthropic".`);
}
