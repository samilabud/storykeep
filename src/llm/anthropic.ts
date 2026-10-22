import Anthropic from "@anthropic-ai/sdk";
import { costCents } from "./pricing";
import { buildAssistantSystemPrompt, buildDraftPrompt } from "./prompt";
import {
  LlmError,
  type ChatRequest,
  type ChatResult,
  type DraftRequest,
  type DraftResult,
  type LlmProvider,
} from "./provider";

// Haiku is the cheapest current model: about 0.06 cents per draft, against
// about 2.5 cents on Opus. Change it with ANTHROPIC_MODEL.
const DEFAULT_MODEL = "claude-haiku-5-5";

// Haiku has no server-side fallback, so the option is sent only to the
// model families that support it.
const supportsFallback = (model: string) => !model.startsWith("claude-haiku");

/** The SDK methods this provider uses. Tests pass a fake with this shape. */
type MessagesClient = Pick<Anthropic["beta"]["messages"], "create" | "stream">;

// A chat reply is short. This caps the cost of one reply.
const CHAT_MAX_TOKENS = 4000;

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly messages: MessagesClient;
  private readonly model: string;

  constructor(options: { messages?: MessagesClient; model?: string } = {}) {
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.messages =
      options.messages ??
      // The SDK reads ANTHROPIC_API_KEY from the environment.
      // maxRetries is 0 because the job queue owns retries. Two layers of
      // retry would multiply each other.
      new Anthropic({ maxRetries: 0, timeout: 120_000 }).beta.messages;
  }

  async generateDraft(request: DraftRequest): Promise<DraftResult> {
    const { system, user } = buildDraftPrompt(request);

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.messages.create({
        model: this.model,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        system,
        messages: [{ role: "user", content: user }],
        // If the model declines on a safety check, the API re-runs the
        // request once on a fallback model inside the same call.
        ...(supportsFallback(this.model)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      });
    } catch (error) {
      throw toLlmError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new LlmError("LLM_REFUSED", "The model declined this request", false);
    }
    if (response.stop_reason === "max_tokens") {
      // A draft cut off in the middle is not a draft. Trying again would
      // hit the same limit, so do not retry.
      throw new LlmError("LLM_REJECTED", "The draft hit the length limit", false);
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (text === "") {
      throw new LlmError("LLM_UNAVAILABLE", "The model returned no text", true);
    }

    const { input_tokens, output_tokens } = response.usage;
    return {
      text,
      provider: this.name,
      // response.model is the model that really answered. With a fallback it
      // can differ from the one we asked for, and so can the price.
      model: response.model,
      inputTokens: input_tokens,
      outputTokens: output_tokens,
      costCents: costCents(response.model, input_tokens, output_tokens),
    };
  }

  async streamChat(
    request: ChatRequest,
    onText: (text: string) => void,
  ): Promise<ChatResult> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      const stream = this.messages.stream({
        model: this.model,
        max_tokens: CHAT_MAX_TOKENS,
        // Chat does well at low effort, and the user is waiting.
        output_config: { effort: "low" },
        system: buildAssistantSystemPrompt(request),
        messages: request.turns,
        ...(supportsFallback(this.model)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          onText(event.delta.text);
        }
      }
      response = await stream.finalMessage();
    } catch (error) {
      throw toLlmError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new LlmError("LLM_REFUSED", "The model declined this request", false);
    }

    // A reply cut off at max_tokens is still useful in a chat, so keep it.
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const { input_tokens, output_tokens } = response.usage;
    return {
      text,
      provider: this.name,
      model: response.model,
      inputTokens: input_tokens,
      outputTokens: output_tokens,
      costCents: costCents(response.model, input_tokens, output_tokens),
    };
  }
}

// Most specific class first. 429 and 5xx are temporary. Other 4xx mean our
// request or key is wrong, and the same request would fail again.
function toLlmError(error: unknown): LlmError {
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError("LLM_UNAVAILABLE", "Rate limited", true, { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmError("LLM_UNAVAILABLE", "Network error or timeout", true, {
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    return status >= 500
      ? new LlmError("LLM_UNAVAILABLE", `Provider error ${status}`, true, {
          cause: error,
        })
      : new LlmError("LLM_REJECTED", `Request rejected (${status})`, false, {
          cause: error,
        });
  }
  return new LlmError("LLM_UNAVAILABLE", "Unexpected error", true, { cause: error });
}
