# Deploying to Vercel (free tier)

The app runs on Vercel Hobby with a Neon Postgres database. Stripe stays in
**test mode**. Nothing here costs money except real LLM calls, if you turn
them on.

## What is different from local

| Local | On Vercel |
|---|---|
| Postgres in Docker | Neon Postgres |
| `pnpm worker` loops forever | No long-running process. The app runs waiting jobs right after it queues one (`after()`), and a daily cron is the safety net. |
| `stripe listen` forwards webhooks | A webhook endpoint in the Stripe dashboard points at the public URL |
| Mailpit catches email | No SMTP: emails are written to the function log |

The queue is the same in both places: rows in `jobs`, claimed with
`SKIP LOCKED`, idempotent handlers. Only *who calls* `runNextJob` changes.

## Steps

### 1. Database
In the Vercel project: **Storage → Create Database → Neon** (free plan) and
connect it to the project. This adds `DATABASE_URL` to the project for you.

### 2. Environment variables
In **Settings → Environment Variables**, for Production:

| Name | Value |
|---|---|
| `DATABASE_URL` | Added by step 1 |
| `AUTH_SECRET` | A new secret: `openssl rand -base64 32` |
| `CRON_SECRET` | A new secret: `openssl rand -hex 32` |
| `STRIPE_SECRET_KEY` | Your Stripe **test** key (`sk_test_...`). The app refuses any other kind. |
| `STRIPE_WEBHOOK_SECRET` | From step 4 |
| `LLM_PROVIDER` | `mock` (free), or `anthropic` |
| `ANTHROPIC_API_KEY` | Only with `LLM_PROVIDER=anthropic` |
| `LLM_DAILY_COST_CAP_CENTS` | For a public URL use a low number, for example `10` |

`APP_URL` is optional. Without it the app uses the project's production domain.

### 3. Deploy
Push to GitHub, or press **Redeploy** in Vercel. The build runs
`pnpm db:migrate && pnpm build` (see `vercel.json`), so the database tables
are created before the app starts.

### 4. Stripe webhook
In the Stripe dashboard (sandbox): **Developers → Webhooks → Add destination**.

- URL: `https://<your-production-domain>/api/stripe/webhook`
- Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `charge.refunded`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.paid`, `invoice.payment_failed`

Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` in Vercel,
then redeploy so the app picks it up.

Use the **production** domain. Vercel protects preview URLs with a login by
default, and Stripe cannot pass that.

### 5. Check it
1. Register, create a eulogy, answer one question.
2. Pay with the test card `4242 4242 4242 4242`.
3. The page should show "Payment received" within a few seconds. If it stays
   on "Confirming your payment…", the webhook is not arriving: check the
   endpoint's delivery log in Stripe.
4. Write the draft.

## Limits of this setup

- **A draft must finish inside one function run** (60 seconds here). Fine for
  one LLM call. A longer job would need a real worker.
- **Retries wait for a trigger.** A retry after its backoff delay runs when
  something calls the queue again: the story page while it shows "Writing
  your draft…", any new job, or the daily cron. With a real worker it would
  run on time.
- **Vercel Hobby cron runs once a day.** It is a safety net, not a scheduler.
- **Hobby is for non-commercial use.** This is a test-mode learning project.
- **The cost cap is per user.** A public URL lets anyone sign up. Keep
  `LLM_PROVIDER=mock`, or keep the cap low.

## Proof that the deployed site works

`tests/e2e/deployed.spec.ts` runs one full flow against a live URL:

```bash
E2E_BASE_URL=https://storykeep-one.vercel.app pnpm test:e2e:deployed
```

Result on 2026-10-13 against `https://storykeep-one.vercel.app`: passed in 15.8s.
A browser registered a user, created a eulogy, paid $9 on Stripe Checkout with
the test card 4242, saw the page unlock after Stripe called the deployed
webhook, and got a draft as version 1 with no worker process running.
Screenshot: [evidence/deployed-smoke.png](evidence/deployed-smoke.png).

What this proves about production: the Neon database and its migrations, the
login, the Stripe webhook endpoint with its signing secret, and the job queue
driven by `after()`.
