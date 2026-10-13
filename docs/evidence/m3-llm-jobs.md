# M3 evidence: LLM drafts in idempotent background jobs

**Claims:** an LLM draft is generated in a background job that survives the
page being closed. Failed jobs are retried with backoff. A retried job never
creates a duplicate draft. Spending is capped per user per day and recorded in
a usage table.

## Automated tests

| Test | File | What it proves |
|---|---|---|
| Vitest, 17 tests | `tests/integration/draft-jobs.test.ts` | See the list below. Real Postgres, mock model. |
| Vitest, 15 tests | `tests/unit/llm.test.ts` | Anthropic provider with the SDK replaced by a fake: text, tokens and cost are read correctly, 429 / 5xx / network errors are retryable, 400 / 401 / refusal / cut-off are not. Pricing rounds up. Backoff doubles. |
| Playwright, 1 test | `tests/e2e/draft.spec.ts` | A real worker process. The browser asks for a draft, the page is closed while the job runs, no tab is open for 5 seconds, and on return the draft is version 1. |

The two tests your prompt asked for by name:

- **"a job that fails once and is retried creates exactly one version"**: the
  first run fails and goes back to `queued`. One second later nothing runs,
  because of the backoff. At +5s it runs and succeeds. One draft, `attempts = 2`.
- **"a failing LLM is retried, then marked failed with a clear message"**:
  three tries at +0s, +5s, +15s give `queued, queued, failed`. `last_error` is
  `LLM_UNAVAILABLE: Mock model is overloaded` and the user sees "We could not
  write your draft after several tries. Your answers are safe. Please try
  again."

Other cases covered:

- Two clicks, or five requests at once, give one job row.
- Three workers claiming at once: exactly one gets the job.
- A worker that saves the draft and then dies: the job is picked up again
  after the lock goes stale, and there is still one draft, one LLM call and
  one usage row.
- The same handler run twice at the same time: two LLM calls, one draft.
- "Try again" after a failure reuses the same job row.
- Cost cap: with 60-cent calls and a 100-cent cap, the third draft fails with
  `COST_CAP` before any LLM call. The cap resets the next day and is per user.
- Another user cannot request or see a draft job.

Full output: [m3-test-output.log](m3-test-output.log)

## The idempotency tests can fail

I removed the "already done?" check from the handler and from `saveVersion`:

```
× a worker that dies after saving the draft does not create a second one
× the same handler run twice at once still saves one draft
error: duplicate key value violates unique constraint "story_versions_idempotency_key_unique"
Tests  2 failed | 55 passed (57)
```

The tests failed, and the UNIQUE constraint still refused the second draft.
With the checks back, all 57 pass.

## Screenshots

- [m3-draft-in-progress.png](m3-draft-in-progress.png): "Writing your draft…" just before the page is closed.
- [m3-draft-ready.png](m3-draft-ready.png): after coming back, version 1 is an AI draft.

## Not proven

The real Anthropic API was not called. See "Not proven yet" in
[DECISIONS.md](../DECISIONS.md). To check it: put `ANTHROPIC_API_KEY` in
`.env.local` and run `pnpm llm:smoke`.

## How to repeat it

```bash
docker compose up -d && pnpm db:migrate
pnpm test
pnpm test:e2e        # starts its own worker with the mock model
# by hand:
pnpm dev             # terminal 1
pnpm worker          # terminal 2
```
