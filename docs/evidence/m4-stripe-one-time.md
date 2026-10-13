# M4 evidence: Stripe one-time payment with replay-safe webhooks

**Claims:** a $9 one-time payment through Stripe Checkout (test mode) unlocks
one eulogy generation. The webhook verifies Stripe's signature. A replayed
event is ignored: one order, one unlock.

## 1. Automated tests (no network)

`tests/integration/stripe-one-time.test.ts`, 21 tests, real Postgres. Events
are signed with Stripe's own test helper, so real signature checking runs.

The test your prompt asked for by name:

- **"the same checkout.session.completed twice gives one order and one unlock"**:
  the first call returns `processed`, the second `duplicate`. One row in
  `orders`, one row in `stripe_events`. The first draft request is accepted
  and the second answers `payment_required`.

Also covered:

- The same event delivered five times at the same moment: processed once.
- A different event id for the same Checkout Session: still one order.
- A replay after the unlock was used does not give a second unlock.
- A handler error rolls the event back, and the retry then succeeds.
- Signature: accepted when valid. Rejected with 400 for a missing header, a
  wrong secret, a body changed after signing, and a timestamp 10 minutes old.
- No draft before payment. A session that is "completed" but not "paid" does
  not unlock. Five draft requests at once use the payment once. A failed job
  can be retried without paying again. A full refund removes the unlock.

Full output: [m4-test-output.log](m4-test-output.log)

### The replay tests can fail

I changed the event insert so it no longer detects a conflict:

```
× the same checkout.session.completed twice gives one order and one unlock
× the same event delivered five times at once is processed once
× a replay after the unlock was used does not give a second unlock
× answers 200 'duplicate' when Stripe sends the same event again
Tests  4 failed | 74 passed (78)
```

## 2. A real payment in Stripe test mode

`tests/e2e/payment.spec.ts` (run with `pnpm test:e2e:stripe`). A real browser:

1. Creates a eulogy and sees "Pay $9 with Stripe". There is no draft button.
2. Pays on Stripe's hosted Checkout page with the test card `4242 4242 4242 4242`.
3. Returns to the app. After the real webhook arrives, the page shows
   "Payment received. Your eulogy draft is unlocked."
4. Writes the draft. The page then says another draft is a new purchase.

Result: passed in 11.6s on 2026-10-13.

- [m4-1-before-payment.png](m4-1-before-payment.png)
- [m4-2-unlocked.png](m4-2-unlocked.png)
- [m4-3-used.png](m4-3-used.png)

There is no screenshot of Stripe's own page. It renders as blank placeholders
in a headless screenshot.

## 3. Replay of the real event

[m4-real-replay.log](m4-real-replay.log), made by `scripts/replay-stripe-event.sh`.
The real `checkout.session.completed` event from step 2 was sent again twice
with `stripe events resend`. The app answered 200 both times. Before and
after: 13 events, 2 orders, the same `received_at`, the order still `paid`
and `used`.

## 4. A forged webhook over real HTTP

[m4-forged-webhook.log](m4-forged-webhook.log). A `curl` with no signature and
one with a made-up signature both get `HTTP 400`, and nothing is stored.

## How to repeat it

```bash
pnpm dev                 # terminal 1
pnpm stripe:listen       # terminal 2: forwards Stripe test webhooks to the app
pnpm test                # offline tests
pnpm test:e2e:stripe     # real test-mode payment in a browser
./scripts/replay-stripe-event.sh
```
