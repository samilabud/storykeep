# Final report: what is proven

Rule for this project: **only what was really built and tested may be
claimed.** This page lists the claims, the evidence for each, and what is not
proven. Date: 2026-10-13.

## Final state

| Check | Result |
|---|---|
| Unit and integration tests (Vitest, real Postgres) | 191 of 191 pass |
| Browser tests (Playwright, local) | 7 of 7 pass |
| Real Stripe test mode: one-time payment, subscription | 2 of 2 pass |
| Real Stripe test clocks: dunning scenarios A and B | 2 of 2 pass |
| Smoke test on the live site (payment, draft, downloads) | passes |
| CI on GitHub Actions (lint, typecheck, tests, build) | green |
| Fresh clone: install, migrate, test, build | works, 34 seconds |

Live: https://storykeep-one.vercel.app · Code: https://github.com/samilabud/storykeep

## Claims I can make

Each line is something I built, tested and can explain.

### Stripe billing

1. **Stripe Checkout one-time payment.** A $9 payment unlocks exactly one
   generation. Evidence: `docs/evidence/m4-stripe-one-time.md`.
2. **Signature-verified, replay-safe webhooks.** An events table keyed by
   Stripe's event id, written in the same transaction as the state change.
   A real event replayed twice changed nothing. A forged request gets 400.
   Evidence: `m4-real-replay.log`, `m4-forged-webhook.log`.
3. **Subscription with dunning.** `active -> past_due -> active` (a retry
   succeeds) and `active -> past_due -> canceled` (retries run out), with a
   3 day grace period, a banner and an email. Run against real Stripe test
   clocks with the failing card `4000 0000 0000 0341`.
   Evidence: `docs/evidence/dunning.md`.
4. **Out-of-order webhooks handled.** A pure state machine, tested with every
   possible arrival order of each scenario (up to 5,040 orders).
   Evidence: `tests/unit/subscription-state-machine.test.ts`.
5. **Stripe Customer Portal** opens for card updates and cancellation, and a
   cancellation revokes access. Evidence: `tests/e2e/subscription.spec.ts`.
6. **Access derived from webhook-fed state**, never from the browser.

### Documents

7. **Server-side PDF generation** with an embedded Unicode font, a cover page,
   page numbers and no orphan headings.
8. **Server-side DOCX generation** with real heading styles, a page-number
   footer and "keep with next" on headings.
9. **One content model for both formats**, with tests that parse the
   generated files (PDF text per page, DOCX XML).
   Evidence: `docs/evidence/m6-export.md`, `docs/evidence/samples/`.

### LLM and background jobs

10. **LLM generation in background jobs** on a Postgres-backed queue
    (`FOR UPDATE SKIP LOCKED`), with retries and exponential backoff.
11. **Idempotent jobs.** An idempotency key per (story, version). A retried
    job, a crashed worker and two concurrent runs each produce exactly one
    draft. Evidence: `docs/evidence/m3-llm-jobs.md`.
12. **Per-user daily cost cap** backed by a usage table.
13. **Anthropic Claude through the official SDK**, behind a provider interface
    with a mock. Real calls were made on Opus and on Haiku.
    Evidence: `docs/evidence/m3-real-api-smoke.md`.
14. **Transactional outbox for email.** Evidence:
    `tests/integration/stripe-subscription.test.ts`.

### Foundation

15. **Per-user access control** enforced in the data layer and tested.
16. **Append-only version history** for answers and story text, with restore.
17. **Deployed on Vercel with Neon Postgres**, with the job queue running
    without a worker process. Evidence: `docs/DEPLOY.md`.
18. **CI on GitHub Actions** with a real Postgres service.

## Suggested wording for a profile

> Built and tested a Stripe subscription flow with dunning (past_due grace
> period, automatic retries, cancellation) using Stripe test clocks;
> implemented signature-verified, replay-safe webhooks with an events table,
> and a state machine that handles out-of-order events; generated PDF and
> DOCX server-side from one content model with consistent typography, page
> numbers and page breaks; ran LLM generation (Anthropic Claude) in
> idempotent background jobs on a Postgres queue with retries and cost caps.
> Next.js, TypeScript, PostgreSQL. Deployed on Vercel.

Shorter, for a one-line skill list:

> Stripe (Checkout, subscriptions, dunning, webhooks, test clocks) · PDF and
> DOCX generation in Node · background job queues and idempotency ·
> LLM integration (Anthropic SDK)

## What I must NOT claim

| Not proven | Why |
|---|---|
| Stripe in production, or real money | Test mode only. |
| "Handled dunning in production" | This is a project with test clocks, not a production system. The honest phrase is "built and tested". |
| Tax, proration, plan changes, trials, multi-currency | Not built. |
| Refund handling | Only a full refund marks an order refunded. |
| The portal's cancel and update-card screens | The test opens the portal, then cancels through the API. |
| The Word file in Microsoft Word | Checked in LibreOffice only. I should open a sample in Word myself. |
| Pixel-identical PDF and DOCX | They share sizes, margins and structure. The typeface differs (DejaVu Serif and Georgia). |
| A strict cost cap | It is per user and soft. |
| Email delivery in production | On Vercel emails are logged, not sent. Locally they go to Mailpit. |
| Scale or load | Never load-tested. |
| A reconcile job against Stripe | Described, not built. |

## How honest is "I built this"?

I built it in a pair-programming session with Claude Code as the senior pair.
Claude wrote most of the code. I chose the scope, reviewed each milestone,
set up the accounts, and ran the real API and payment steps. What I can
truthfully say: **I built and tested this project with AI assistance, and I
can explain every part of it.** The second half of that sentence is only true
after I have worked through `docs/INTERVIEW_NOTES.md`.

## If asked "have you done this in production?"

> "Not dunning in production. I built a project that runs the full flow
> against Stripe test clocks: the failed renewal, the retries, the grace
> period and the cancellation. I can walk you through the state machine, how
> I handle out-of-order webhooks, and what I would monitor."
