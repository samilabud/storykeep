# M3 evidence: one real Anthropic API call

Run by me (Samil) on 2026-10-13 with `pnpm llm:smoke`. The script calls
`AnthropicLlmProvider.generateDraft` with two sample answers. Nothing is saved
to the database.

## Result

```
model=claude-opus-5-5 input_tokens=299 output_tokens=1206 cost_cents=3
```

Cost check by hand: 299 × $4/M + 1206 × $20/M = $0.0253, rounded up to 3 cents.
This matches `costCents()` in `src/llm/pricing.ts`.

## What it shows

- The key, the request shape and the response parsing work against the real API.
- The model followed the format rules in the prompt: a title line, then four
  sections that each start with `## `.
- It used only the two facts it was given (the name "Joseph Ellis, called Joe"
  and "carpenter for forty years, built half the porches on our street"). It
  added no names, dates or places.

## Output (first and last section)

```
Grandpa Joe

## The Man We Knew as Joe

His name was Joseph Ellis. But almost nobody called him Joseph. To everyone, he
was simply Joe. And to some of us gathered here today, he was Grandpa Joe.
[...]

## What Stays With Us

[...]
Thank you, Grandpa Joe. We will miss you.
```

## What it does not show

The full path "button, job, worker, real model, saved version" was run with the
mock model only (see [m3-llm-jobs.md](m3-llm-jobs.md)). The smoke script calls
the provider directly.
