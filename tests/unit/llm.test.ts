import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { backoffMs } from "@/jobs/queue";
import { AnthropicLlmProvider } from "@/llm/anthropic";
import { costCents } from "@/llm/pricing";
import { buildDraftPrompt } from "@/llm/prompt";
import { LlmError, type DraftRequest } from "@/llm/provider";

const request: DraftRequest = {
  kind: "eulogy",
  title: "Grandpa Joe",
  answers: [{ question: "What work did they do?", answer: "Carpenter" }],
};

// No network here. The SDK client is replaced by a function that returns a
// canned response or throws a real SDK error class.
type Create = ConstructorParameters<typeof AnthropicLlmProvider>[0] extends
  | { messages?: infer M }
  | undefined
  ? M extends { create: infer C }
    ? C
    : never
  : never;

function providerReturning(response: object, seen?: { params?: unknown }) {
  const create = (async (params: unknown) => {
    if (seen) seen.params = params;
    return response;
  }) as unknown as Create;
  return new AnthropicLlmProvider({ messages: { create }, model: "claude-opus-5-5" });
}

function providerThrowing(error: unknown) {
  const create = (async () => {
    throw error;
  }) as unknown as Create;
  return new AnthropicLlmProvider({ messages: { create }, model: "claude-opus-5-5" });
}

const okResponse = {
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [
    { type: "thinking", thinking: "" },
    { type: "text", text: "Grandpa Joe\n\n## Work\n\nHe was a carpenter." },
  ],
  usage: { input_tokens: 1000, output_tokens: 2000 },
};

async function errorFrom(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmError);
    return error as LlmError;
  }
  throw new Error("Expected the call to fail");
}

describe("Anthropic provider (SDK replaced by a fake)", () => {
  it("returns the text, the token counts and the cost", async () => {
    const result = await providerReturning(okResponse).generateDraft(request);
    expect(result).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5-5",
      inputTokens: 1000,
      outputTokens: 2000,
      // 1000 * $4/M + 2000 * $20/M = $0.044, rounded up to 5 cents
      costCents: 5,
    });
    expect(result.text).toContain("He was a carpenter.");
  });

  it("sends the answers and the no-invention rule to the model", async () => {
    const seen: { params?: unknown } = {};
    await providerReturning(okResponse, seen).generateDraft(request);
    const params = seen.params as {
      model: string;
      system: string;
      messages: { content: string }[];
    };
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.system).toContain("Never invent");
    expect(params.messages[0].content).toContain("Carpenter");
  });

  it("prices by the model that answered, which can be a fallback", async () => {
    const result = await providerReturning({
      ...okResponse,
      model: "claude-sonnet-5-5",
    }).generateDraft(request);
    // 1000 * $2/M + 2000 * $10/M = $0.022, rounded up to 3 cents
    expect(result).toMatchObject({ model: "claude-sonnet-5-5", costCents: 3 });
  });

  it("treats a refusal as final, not retryable", async () => {
    const error = await errorFrom(
      providerReturning({ ...okResponse, stop_reason: "refusal", content: [] }).generateDraft(request),
    );
    expect(error).toMatchObject({ code: "LLM_REFUSED", retryable: false });
  });

  it("treats a draft cut off by the length limit as final", async () => {
    const error = await errorFrom(
      providerReturning({ ...okResponse, stop_reason: "max_tokens" }).generateDraft(request),
    );
    expect(error).toMatchObject({ code: "LLM_REJECTED", retryable: false });
  });

  const headers = new Headers();
  it.each([
    ["rate limit (429)", new Anthropic.RateLimitError(429, undefined, "slow down", headers), true],
    ["server error (500)", new Anthropic.InternalServerError(500, undefined, "oops", headers), true],
    ["overloaded (529)", new Anthropic.APIError(529, undefined, "overloaded", headers), true],
    ["network failure", new Anthropic.APIConnectionError({ message: "socket hang up" }), true],
    ["bad API key (401)", new Anthropic.AuthenticationError(401, undefined, "bad key", headers), false],
    ["bad request (400)", new Anthropic.BadRequestError(400, undefined, "bad", headers), false],
  ])("classifies %s as retryable=%s", async (_name, sdkError, retryable) => {
    const error = await errorFrom(providerThrowing(sdkError).generateDraft(request));
    expect(error.retryable).toBe(retryable);
  });
});

describe("pricing", () => {
  it("rounds up to whole cents", () => {
    expect(costCents("claude-haiku-5-5", 1000, 1000)).toBe(1); // $0.0006
    expect(costCents("claude-opus-5-5", 0, 0)).toBe(0);
  });

  it("charges an unknown model at the highest rate", () => {
    // 1M in * $10 + 1M out * $50 = $60
    expect(costCents("some-future-model", 1_000_000, 1_000_000)).toBe(6000);
  });
});

describe("prompt", () => {
  it("asks for the right kind of text", () => {
    expect(buildDraftPrompt(request).user).toContain("a eulogy to be read aloud");
    expect(buildDraftPrompt({ ...request, kind: "life_story" }).user).toContain(
      "a written life story",
    );
  });
});

describe("backoff", () => {
  it("doubles after each failed try and stops growing at 5 minutes", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(backoffMs(20)).toBe(300_000);
  });
});
