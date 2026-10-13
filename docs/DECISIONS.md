# Decisions

Short notes on what was chosen, why, and what was cut. Newest milestone last.

## M1. Foundation

**Drizzle, not Prisma.** Drizzle reads like SQL. This project depends on
unique constraints and `ON CONFLICT DO NOTHING`, and they are visible in the
code instead of hidden behind an ORM.

**`pg` driver.** The plain Postgres driver. The job queue in M3 needs
`FOR UPDATE SKIP LOCKED` inside a transaction, and `pg` does that simply.

**Auth.js v5 with email and password.** A magic link needs a mail flow before
anything else works. A password is faster to build and easy to drive in
Playwright. Trade-off: Auth.js v5 is still a beta release (`5.0.0-beta.32`).
Its v4 line is stable but does not fit the App Router as well. For production
I would pin the version and watch its changelog.

**Sessions are JWTs in an httpOnly cookie.** No session table. Trade-off: a
session cannot be revoked on the server before it expires. That is acceptable
here. A database session would fix it.

**Access control lives in the data layer.** Every function in
`src/stories/data.ts` takes a `userId` and puts it in the `WHERE` clause.
There is no "get story by id" function without a user. A page or route cannot
forget the check, because the query will not run without it.

**404, not 403, for someone else's story.** A 403 tells a stranger that the id
is real. A 404 tells them nothing.

**One wrapper for reading the session (`src/auth/session.ts`).** Two reasons.
First, Next.js 16 with Cache Components tries to prerender pages at build
time. `connection()` tells it that this code needs a live request. Second,
tests replace this one module to choose who is signed in. Everything else in
the tests is real.

**Tests use a real Postgres, not mocks.** A second container on port 5441,
held in memory. The real migrations run before the tests. Access control and,
later, idempotency are enforced by the database, so a mocked database would
prove nothing.

**Ports 5440 / 5441 / 3100.** The usual 5432 and 3000 were already taken on
my machine. Fixed, unusual ports avoid a confusing clash.

**Kept the Next.js 16 defaults (Cache Components, Partial Prefetching).** Cost:
any component that reads the session must sit inside `<Suspense>`. Known
effect: a page redirect or "not found" that happens inside `<Suspense>` is
sent after the response has started, so the HTTP status of the *page* is 200
even though the browser shows the 404 page or lands on `/login`. The JSON API
returns true 401 and 404 status codes, and that is what the tests assert on.

### Bug found by the tests

After a failed login, the email field was empty. React 19 resets a form when
its action finishes. Fix: the action returns the typed email and the input
uses it as `defaultValue`. The Playwright test now checks this.

### Cut or postponed

- No password reset and no email verification. Out of scope for the weekend.
- No rate limit on login. I would add one for production.
- No `proxy.ts` redirect for anonymous visitors. The guards already protect
  the data. A proxy would only make the redirect a little faster.

## M2. Questionnaire and versions

**Append-only history.** An answer is never updated. A changed answer is a
new row with `revision + 1`. Story text works the same way: every save is a
new row in `story_versions`. Reason: history is free, nothing can be lost by
a bad save, and "undo" needs no extra code.

**Restore is a new version.** Restoring version 1 copies its text into a new
version 3. Version 2 stays. A restore can itself be undone.

**A row lock keeps the numbers unique.** To get the next number the code
reads the highest one and adds 1. Two saves at the same moment would both
read "3" and both write "4". So every write first runs
`SELECT ... FOR UPDATE` on the story row. The second save waits until the
first has committed. The same query also checks that the user owns the story.
The `UNIQUE (story_id, version_no)` constraint is the safety net if the lock
is ever removed. I removed the lock as an experiment and the concurrency
tests failed with a duplicate key error.

**Trade-off of the lock.** All writes to one story wait in line. That is fine
here, because one person edits one story. For many writers on one document I
would use a sequence or retry on conflict instead.

**Saving the same value again does nothing.** No new row. The history shows
real changes only, and a double click cannot create a duplicate.

**A skip is a saved row.** `skipped = true`, `answer_text = NULL`. So "skipped"
and "not reached yet" are different, and resume can tell them apart. An empty
answer is stored as a skip.

**Resume is computed, not stored.** There is no "current step" column. The
page finds the first question with no row. One fewer thing that can get out
of sync with the answers.

**Questions live in code, answers are stored by key.** The wording can change
without a migration. Trade-off: removing a question leaves old rows behind,
which are ignored.

**`story_versions.idempotency_key` is already written by `saveVersion`.** M3
uses it so a retried LLM job cannot insert a second draft.

### Cut or postponed

- No rich text editor. A plain textarea is enough to prove versions.
- No diff view between versions.
- No autosave while typing. The user saves each answer with a button.

## M3. LLM drafts in background jobs

**A Postgres table as the queue, not Inngest.** No extra service to run. The
whole queue is about 150 lines in `src/jobs/`, and I can explain each one.
Trade-off: the worker polls once per second, so a job can wait up to a second.
For high volume I would use a real queue or `LISTEN/NOTIFY`.

**The web request only inserts a row.** `requestDraft` writes one row to
`jobs` and returns. A separate process (`pnpm worker`) does the slow LLM call.
The draft is written even if the user closes the tab or the web server
restarts.

**`FOR UPDATE SKIP LOCKED` to claim a job.** A worker locks the row it takes.
`SKIP LOCKED` makes other workers skip that row instead of waiting. Two
workers can never take the same job.

**At-least-once delivery, so handlers must be idempotent.** A job can run
twice: after a failure, or when a worker dies halfway. A queue cannot promise
"exactly once". What it can promise is "never forgotten". So the handler is
written to be safe to repeat.

**How a retry cannot create a duplicate draft. Three layers:**
1. `jobs.idempotency_key` is UNIQUE. The key is `draft:<story>:v<next version>`.
   A double click builds the same key, so only one job row exists.
2. The handler first looks for a version with that key. If it is there, an
   earlier run already finished, and no second paid LLM call is made.
3. `story_versions.idempotency_key` is UNIQUE. If two runs race past step 2,
   the database lets only one row in.

I removed layers 2 and the check inside `saveVersion` as an experiment. The
tests failed, and layer 3 still blocked the duplicate with a unique violation.

**Retries with exponential backoff.** 3 tries. Waits of 5s, then 10s (the
delay doubles, with a 5 minute ceiling). Reason: a provider that is overloaded
needs time. Retrying at once makes it worse.

**Retryable or not is decided by the error type.** Rate limit, 5xx and network
errors are temporary: retry. A bad request, a bad key, a refusal or a cut-off
draft would fail the same way again: fail at once. The SDK's own retries are
off (`maxRetries: 0`) so two retry layers do not multiply.

**Stale lock recovery.** A job `running` for more than 5 minutes is treated as
a dead worker and is claimed again. Trade-off: a job that really takes more
than 5 minutes would run twice. That is safe here (idempotent) but wasteful.
A heartbeat would fix it.

**Two messages per failure.** `jobs.last_error` keeps the technical cause
(`LLM_UNAVAILABLE: Rate limited`). The user sees plain words chosen from the
error code. Users never see a stack trace.

**Daily cost cap per user.** Default 100 cents per UTC day. Every LLM call
that returns writes a row to `llm_usage`. Before a call, the handler sums
today's rows. Cost is rounded up to whole cents, and an unknown model is
priced at the highest rate, so the cap can trigger early but never late.
Known gap: it is a soft cap. Two jobs for one user at the same moment can both
pass the check. I block that case anyway (one active draft job per story), but
a strict cap would reserve the budget in the same transaction.

**Usage is recorded when money is spent, not when the draft is saved.** If the
save fails after a successful call, the usage row still exists. The table
should match the provider's invoice.

**Mock provider by default.** `LLM_PROVIDER=mock` builds a draft from the
answers with no network call. Tests are free, offline and repeatable.

**Anthropic provider.** Model `claude-opus-5-5`, set by `ANTHROPIC_MODEL`.
It uses the API's server-side fallback, so a safety decline is retried once on
another model inside the same call. Cost is priced by the model that really
answered.

### Proven with the real API

- One real call with `pnpm llm:smoke` on 2026-10-13: `claude-opus-5-5`,
  299 input tokens, 1206 output tokens, 3 cents. See
  `docs/evidence/m3-real-api-smoke.md`.
- Still mock only: the full path from the button through the worker. The
  smoke script calls the provider directly.

### Cut or postponed

- No streaming of the draft into the page. The page polls every 2 seconds.
- No job dashboard. `select * from jobs` is the dashboard.
- No dead-letter queue. A failed job stays in the table with its error.

## M4. Stripe one-time payment

**Stripe-hosted Checkout.** The browser is sent to Stripe's page. Card numbers
never touch my server, so I have no card data to protect.

**The price is set on the server.** The browser sends only "I want to pay for
story X". The amount (900 cents) is a constant in `src/billing/stripe.ts`.
A user cannot change the price by editing the page.

**Access comes from the webhook, never from the redirect.** After paying, the
browser returns to `?checkout=success`. Anyone can type that URL. So the page
unlocks nothing from it. It shows "Confirming your payment…" and waits until
the webhook has marked the order as paid in my database.

**Signature verification on the raw body.** The webhook URL is public. Stripe
signs each request with a shared secret (an HMAC of the timestamp and the
exact bytes). The route reads the body as raw text and checks the signature
before doing anything. A changed body, a wrong secret or an old timestamp is
rejected with 400.

**How I prevent double processing. Three layers:**
1. `stripe_events.id` is Stripe's event id and the PRIMARY KEY. The handler
   first inserts the event with `ON CONFLICT DO NOTHING`. No row inserted
   means "seen before", and it stops.
2. The insert and the changes run in ONE transaction. If the changes fail,
   the insert is rolled back, so Stripe's retry gets a second chance. Without
   this, a crash after the insert would lose the event forever.
3. `orders.stripe_checkout_session_id` is UNIQUE and the order is written as
   an upsert. Even a different event about the same session gives one order.

**Why Stripe sends duplicates at all.** Stripe promises "at least once". It
retries when my server answers slowly or with an error, and a human can press
"resend" in the dashboard. A webhook handler that is not idempotent will
sooner or later give something away twice.

**200 for a duplicate, 500 for a failure.** A duplicate is success from
Stripe's point of view: stop sending. A real failure must be a 5xx so Stripe
retries later.

**`payment_status === "paid"`, not just "completed".** `checkout.session.completed`
means the customer finished the form. With slow payment methods the money can
still be on its way. The order is unlocked only when it is paid.

**One paid order buys one generation.** The order is marked used
(`consumed_at`) in the same transaction that creates the job, with the order
row locked. Five requests at once start one job. If the job later fails,
"Try again" is free, because that payment has not produced a draft yet.

**How I prevent double charges.**
- No second checkout is started while a paid, unused order exists.
- The Stripe customer is created with an idempotency key (`customer:<userId>`),
  so two requests create one customer.
- Known gap: two fast clicks on "Pay" can create two Checkout Sessions. The
  user would have to pay on both pages to be charged twice. Reusing the open
  session would close this gap.

**Tests never call Stripe.** They build events and sign them with Stripe's own
test helper, so real signature verification runs offline. The real Stripe
round trip is a separate Playwright test (`pnpm test:e2e:stripe`) that needs
`pnpm stripe:listen`.

**Test keys only, enforced in code.** `getStripe()` throws if the key does not
start with `sk_test_`.

### What broke first

- **Stripe "Managed Payments" was on by default in the new sandbox.** Creating
  a Checkout Session failed with "the product tax code is missing". Fix: pass
  `managed_payments: { enabled: false }` on the session. This project does
  not build tax.
- **"Confirming your payment…" never went away after the draft was written.**
  The page still had `?checkout=success` in the URL while the order was
  already used. Fix: the draft action redirects to the clean URL. The real
  payment test found this. The mocked tests could not.

### Cut or postponed

- Life Story is not gated yet. Its subscription comes in M5.
- Download gating comes with the export in M6.
- Refunds: a full refund marks the order `refunded`. Partial refunds are ignored.
- No receipt email. Stripe can send its own.
