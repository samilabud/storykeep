import * as z from "zod";
import { getSessionUserId } from "@/auth/guards";
import {
  CHAT_ERROR_MARKER,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_TURNS,
} from "@/llm/chat-protocol";
import { isOverDailyCap, recordUsage } from "@/llm/cost-cap";
import { getLlmProvider, LlmError } from "@/llm/provider";
import { buildChatRequest } from "@/stories/assistant";

// A chat reply streams for a few seconds, rarely longer.
export const maxDuration = 60;

// Assistant replies can be longer than a user message, but not unbounded.
const MAX_REPLY_LENGTH = 20_000;

const bodySchema = z.object({
  messages: z
    .array(
      z.discriminatedUnion("role", [
        z.object({
          role: z.literal("user"),
          content: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
        }),
        z.object({
          role: z.literal("assistant"),
          content: z.string().trim().min(1).max(MAX_REPLY_LENGTH),
        }),
      ]),
    )
    .min(1)
    .max(MAX_CHAT_TURNS)
    // The model needs the conversation to start and end with the user.
    .refine(
      // Zod still runs this when .min(1) fails, so guard the empty case.
      (turns) => turns[0]?.role === "user" && turns.at(-1)?.role === "user",
      "The conversation must start and end with a user message",
    ),
});

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/stories/[id]/assistant">,
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid conversation" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const request = await buildChatRequest(userId, id, parsed.data.messages);
  if (!request) {
    // 404, not 403: do not reveal that the id belongs to someone else.
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Chat counts against the same daily budget as drafts.
  if (await isOverDailyCap(userId, new Date())) {
    return Response.json(
      { error: "You have reached today's AI limit. Try again tomorrow." },
      { status: 429 },
    );
  }

  const provider = await getLlmProvider();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const result = await provider.streamChat(request, (text) =>
          controller.enqueue(encoder.encode(text)),
        );
        await recordUsage(userId, null, result, new Date());
      } catch (error) {
        console.error("assistant reply failed", error);
        const message =
          error instanceof LlmError && error.code === "LLM_REFUSED"
            ? "The assistant can't help with that request."
            : "The assistant stopped unexpectedly. Please try again.";
        controller.enqueue(encoder.encode(CHAT_ERROR_MARKER + message));
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
