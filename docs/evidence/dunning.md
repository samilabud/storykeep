# Dunning evidence: failed renewals in Stripe test mode

**Claim:** a Stripe subscription moves `active -> past_due -> active` when a
retry succeeds, and `active -> past_due -> canceled` when every retry fails.
During `past_due` the user keeps access for a 3 day grace period, sees a
banner and gets an email. When the subscription ends, access is revoked.

Everything below ran on 2026-10-13 against real Stripe objects in **test
mode**. Time was moved with a **Stripe test clock**. The app was never told
anything directly: it only received Stripe's real webhooks through
`stripe listen`.

Raw timeline, written by the test as it ran: [dunning-run.log](dunning-run.log)

## How the run works

`tests/e2e/dunning.spec.ts`, run with `pnpm test:e2e:dunning` (3.1 minutes).

1. A user registers in the app through the browser.
2. The test creates a Stripe test clock, a customer on that clock and a $7/month
   subscription, paid with `pm_card_visa` (the card `4242 4242 4242 4242`).
3. It swaps the default card for `pm_card_chargeCustomerFail`. This is Stripe's
   token for **`4000 0000 0000 0341`**: attaching the card works, charging it fails.
4. It advances the clock one month plus two hours, so the renewal is charged.
5. After each step it records what Stripe says and what our database says,
   and checks the app in a real browser.

## Scenario A: a failed renewal, then a retry that succeeds

| Step | Test clock | Stripe subscription | Stripe invoice | Our database | App |
|---|---|---|---|---|---|
| A1. Subscribed (card 4242) | Oct 13 | `active` | paid, attempt 1 | `active` | Access. No banner. |
| A2. Renewal with card 0341 fails | Nov 13 | `past_due` | open, attempt 1, next retry Nov 15 | `past_due`, grace set | **Access kept.** Banner shown. Email sent. |
| A3. Card fixed, clock moved to the retry | Nov 15 | `active` | paid, attempt 2 | `active`, grace cleared | Access. Banner gone. |

Screenshots:
- [dunning-a1-past-due-billing.png](dunning-a1-past-due-billing.png): billing page, status `past_due`, access `yes`
- [dunning-a2-banner.png](dunning-a2-banner.png): the banner "Your last payment did not go through."
- [dunning-a3-recovered.png](dunning-a3-recovered.png): back to `active`

Email found in Mailpit for this user: `"Your StoryKeep payment did not go through"`.

In A3 nobody "paid the invoice by hand". The test only changed the default
card and moved the clock to the time in `next_payment_attempt`. Stripe's own
automatic retry charged the card.

## Scenario B: every retry fails

| Step | Test clock | Stripe invoice | Stripe subscription | Our database |
|---|---|---|---|---|
| B1. Subscribed (card 4242) | Oct 13 | paid, attempt 1 | `active` | `active` |
| B2. Renewal with card 0341 fails | Nov 13 | open, attempt 1 | `past_due` | `past_due`, grace set |
| B3. Retry 1 fails | Nov 15 | attempt 2 | `past_due` | `past_due` |
| B4. Retry 2 fails | Nov 17 | attempt 3 | `past_due` | `past_due` |
| B5. Retry 3 fails | Nov 19 | attempt 4 | `past_due` | `past_due` |
| B6. Retry 4 fails | Nov 21 | attempt 5 | `past_due` | `past_due` |
| B7. Retry 5 fails | Nov 22 | attempt 6 | `past_due` | `past_due` |
| B8. Retry 6 fails | Nov 24 | attempt 7 | `past_due` | `past_due` |
| B9. Retry 7 fails | Nov 26 | attempt 8 | `past_due` | `past_due` |
| B10. Retry 8 fails, no retry left | Nov 27 | open, attempt 9 | **`canceled`** | **`canceled`**, grace cleared |

At the end the billing page shows status `canceled` and access `no`:
[dunning-b1-ended.png](dunning-b1-ended.png).

Emails found in Mailpit for this user: one `"Your StoryKeep payment did not
go through"` and one `"Your StoryKeep subscription has ended"`.

## What I learned from the real run

1. **Stripe's retry schedule here is 8 retries over about 2 weeks, then cancel.**
   This is the sandbox's default "Smart Retries" setting. It is configured in
   the Stripe dashboard (Billing, revenue recovery), not in my code. The final
   status could also be `unpaid` with another setting. The app treats both as
   "no access", and both are tested.
2. **My 3 day grace period is shorter than Stripe's 2 week retry window.**
   That is on purpose. After 3 days the user loses access while Stripe keeps
   trying. If a later retry succeeds, access comes back (tested:
   "a late retry that succeeds after the grace period gives access back").
3. **The first version sent an email on every failed retry.** In scenario B
   that was 9 emails about one problem. I changed the email's idempotency key
   from "invoice + attempt number" to "invoice", so one failed invoice sends
   one email. The run above is from after that fix.
4. **Test clocks move Stripe's time, not my app's time.** Stripe's event
   timestamps (`event.created`) stay in real time. So `grace_until` is "real
   now + 3 days" (Oct 16) even though the test clock says November. The end of
   the grace period is therefore proven by the integration tests, which pass
   a `now` value to the access rule, and not by this run.

## Access after the grace period (integration tests)

`tests/integration/stripe-subscription.test.ts`:

- "inside the grace period the user keeps access" (day 2: draft allowed)
- "when the grace period ends, access stops with no new event" (day 4: the
  status is still `past_due`, and the draft request answers `subscription_required`)

No cron job ends the grace period. The access rule compares the clock with
`grace_until` each time it is asked.

## Out-of-order webhooks

Stripe does not promise the order of events. Proven in two places:

- `tests/unit/subscription-state-machine.test.ts`: for each scenario (signup,
  failed renewal, recovery, final failure) the test delivers the events in
  **every possible order** and checks the final state. The recovery scenario
  has 7 events, which is 5,040 orders.
- `tests/integration/stripe-subscription.test.ts`, "out-of-order webhooks":
  the same idea through the real webhook code and a real Postgres, including
  the case from the brief, "`invoice.paid` arrives before
  `subscription.updated`".

The every-order test found a real bug while I was building: if the recovery
payment event was missed, a late `payment_failed` could reopen dunning. It is
fixed (rule 6b in `src/billing/state-machine.ts`).

## A real subscription through Checkout and the Customer Portal

`tests/e2e/subscription.spec.ts` (`pnpm test:e2e:stripe`, 19 seconds). In a
browser: a life story is locked, the user subscribes on Stripe's hosted
Checkout with card 4242, the page shows `active` once the webhooks arrive,
the draft button appears, the Customer Portal opens on `billing.stripe.com`,
and after a cancel the page shows `canceled` with no access.

- [m5-sub-1-locked.png](m5-sub-1-locked.png)
- [m5-sub-2-active.png](m5-sub-2-active.png)
- [m5-sub-3-canceled.png](m5-sub-3-canceled.png)

Not automated: clicking through the portal's own cancel and update-card
screens. The test opens the portal, then cancels through the Stripe API.

## How to repeat it

```bash
pnpm dev                 # terminal 1
pnpm stripe:listen       # terminal 2
pnpm test                # offline: state machine and webhook tests
pnpm test:e2e:stripe     # real Checkout: one-time payment and subscription
pnpm test:e2e:dunning    # real test clocks: scenarios A and B (about 3 minutes)
```

Full test output: [m5-test-output.log](m5-test-output.log)
