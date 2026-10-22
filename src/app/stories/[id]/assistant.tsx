"use client";

import { useEffect, useRef, useState } from "react";
import { buttonPrimary, buttonSecondary, card, field, muted, sectionTitle } from "@/app/ui";
import {
  CHAT_ERROR_MARKER,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_TURNS,
} from "@/llm/chat-protocol";

type Message = {
  role: "user" | "assistant";
  content: string;
  /** Set when the reply failed. Failed replies are not sent back to the model. */
  error?: string;
};

type Props = {
  storyId: string;
  hasAnswers: boolean;
  hasText: boolean;
};

/**
 * A chat about one story. The server gives the model the story's answers and
 * current text, so the browser sends only the conversation. The conversation
 * lives in this tab (sessionStorage) and is never saved on the server.
 */
export function StoryAssistant({ storyId, hasAnswers, hasText }: Props) {
  const storageKey = `storykeep:assistant:${storyId}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // False until the saved conversation is read, so the empty first render
  // cannot overwrite it.
  const [loaded, setLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Restore this tab's conversation after a reload or a trip to another page.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only storage after mount
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      // Storage can be blocked. The chat still works, it just isn't kept.
    }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded || streaming) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // See above.
    }
  }, [loaded, messages, streaming, storageKey]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const suggestions = hasText
    ? [
        "Suggest a warmer opening line",
        "What details feel missing?",
        "Make the ending more personal",
      ]
    : hasAnswers
      ? [
          "Which answers could use more detail?",
          "Help me remember a childhood story",
          "What should a good opening say?",
        ]
      : [
          "How do I get started?",
          "Help me remember the early years",
          "What makes a story feel personal?",
        ];

  async function send(text: string) {
    const content = text.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
    if (!content || streaming) return;

    const history: Message[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    // Leave out failed replies, keep only the newest turns, and start with
    // the user, as the model requires.
    let turns = history
      .filter((m) => !m.error && m.content.trim() !== "")
      .map(({ role, content }) => ({ role, content }))
      .slice(-MAX_CHAT_TURNS);
    while (turns.length > 0 && turns[0].role !== "user") turns = turns.slice(1);

    const update = (patch: Partial<Message>) =>
      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = "";
    try {
      const response = await fetch(`/api/stories/${storyId}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: turns }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        update({ error: body?.error ?? "The assistant is not available right now." });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        const marker = reply.indexOf(CHAT_ERROR_MARKER);
        if (marker >= 0) {
          update({ content: reply.slice(0, marker), error: reply.slice(marker + 1) });
        } else {
          update({ content: reply });
        }
      }
    } catch (error) {
      update(
        controller.signal.aborted
          ? { error: reply ? "Stopped." : "Stopped before a reply." }
          : { error: "Could not reach the assistant. Check your connection and try again." },
      );
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error(error);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be blocked. The text is still selectable.
    }
  }

  return (
    <section id="assistant" aria-labelledby="assistant-title" className={`${card} flex scroll-mt-6 flex-col`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="assistant-title" className={sectionTitle}>
            Story assistant
          </h2>
          <p className={`mt-1 ${muted}`}>
            Knows your answers and the current text. It suggests; you decide.
          </p>
        </div>
        {messages.length > 0 && !streaming && (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="shrink-0 text-xs text-muted underline underline-offset-4 hover:text-accent"
          >
            Clear chat
          </button>
        )}
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation with the story assistant"
        className="mt-4 flex max-h-[28rem] min-h-32 flex-col gap-3 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className={muted}>Try one of these:</p>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="rounded-lg border border-line bg-paper px-3 py-2 text-left text-sm transition hover:border-accent hover:text-accent"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : (
          messages.map((message, index) =>
            message.role === "user" ? (
              <p
                key={index}
                className="ml-8 self-end rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm whitespace-pre-wrap text-accent-ink"
              >
                {message.content}
              </p>
            ) : (
              <div key={index} className="mr-4 flex flex-col gap-1">
                {(message.content || !message.error) && (
                  <div className="rounded-2xl rounded-bl-sm bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap">
                    {message.content || (
                      <span className="inline-flex gap-1" aria-label="The assistant is writing">
                        <Dot delay="0ms" />
                        <Dot delay="150ms" />
                        <Dot delay="300ms" />
                      </span>
                    )}
                  </div>
                )}
                {message.error && (
                  <p className="text-xs text-red-700 dark:text-red-400">{message.error}</p>
                )}
                {message.content && !(streaming && index === messages.length - 1) && (
                  <button
                    type="button"
                    onClick={() => copy(message.content)}
                    className="self-start text-xs text-muted underline-offset-4 hover:text-accent hover:underline"
                  >
                    Copy reply
                  </button>
                )}
              </div>
            ),
          )
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
        className="mt-4 flex flex-col gap-2"
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter makes a new line.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(input);
            }
          }}
          rows={2}
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          aria-label="Message to the story assistant"
          placeholder="Ask for ideas, wording, or help remembering…"
          className={`${field} resize-none text-sm`}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Enter to send · Shift+Enter for a new line</span>
          {streaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className={buttonSecondary}
            >
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className={buttonPrimary}>
              Send
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1.5 animate-bounce rounded-full bg-accent"
      style={{ animationDelay: delay }}
    />
  );
}
