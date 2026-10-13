import { appendFileSync, writeFileSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import type Stripe from "stripe";
import { query } from "./db";
import { register } from "./helpers";
import { stripeForTests } from "./stripe";
import { startMockWorker } from "./worker";

// The dunning run. Real Stripe TEST MODE objects, moved through time with a
// Stripe test clock. Our app only ever sees the real webhooks.
// Needs `pnpm dev` and `pnpm stripe:listen`. Run with:  pnpm test:e2e:dunning
test.skip(!process.env.STRIPE_E2E, "needs Stripe test keys and `pnpm stripe:listen`");
test.setTimeout(15 * 60_000);
test.describe.configure({ mode: "serial" });

const LOG = "docs/evidence/dunning-run.log";
const HOUR = 3600;
const run = Date.now();
const stripe = process.env.STRIPE_E2E ? stripeForTests() : (null as unknown as Stripe);
let worker: ChildProcess;

const iso = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000).toISOString().replace(".000Z", "Z") : "-";
const log = (line = "") => {
  appendFileSync(LOG, line + "\n");
  console.log(line);
};

type DbRow = { status: string; grace_until: Date | null; current_period_end: Date | null };
const dbRow = async (email: string) =>
  (
    await query<DbRow>(
      `select s.status, s.grace_until, s.current_period_end from subscriptions s
       join users u on u.id = s.user_id where u.email = $1`,
      [email],
    )
  )[0];

async function waitForDbStatus(email: string, wanted: string[], timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await dbRow(email);
    if (row && wanted.includes(row.status)) return row;
    if (Date.now() > deadline) {
      throw new Error(`DB status is ${row?.status ?? "none"}, wanted ${wanted.join("/")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

type Subscriber = { email: string; clock: string; customer: string; subscription: string; goodCard: string };

/** Moves the test clock and waits until Stripe has finished the time travel. */
async function advanceClock(sub: Subscriber, to: number) {
  await stripe.testHelpers.testClocks.advance(sub.clock, { frozen_time: to });
  for (;;) {
    const clock = await stripe.testHelpers.testClocks.retrieve(sub.clock);
    if (clock.status === "ready") return;
    if (clock.status === "internal_failure") throw new Error("Stripe test clock failed");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/** One line of the timeline: what Stripe says and what our database says. */
async function snapshot(sub: Subscriber, step: string) {
  const [clock, subscription, row] = await Promise.all([
    stripe.testHelpers.testClocks.retrieve(sub.clock),
    stripe.subscriptions.retrieve(sub.subscription, { expand: ["latest_invoice"] }),
    dbRow(sub.email),
  ]);
  const invoice = subscription.latest_invoice as Stripe.Invoice;
  log(`### ${step}`);
  log(`  test clock time      : ${iso(clock.frozen_time)}`);
  log(`  Stripe subscription  : ${subscription.status}`);
  log(
    `  Stripe latest invoice: ${invoice.status}, attempt_count=${invoice.attempt_count}, ` +
      `next_payment_attempt=${iso(invoice.next_payment_attempt)}`,
  );
  log(
    `  our database         : status=${row?.status}, grace_until=${row?.grace_until?.toISOString() ?? "-"}`,
  );
  log();
  return { subscription, invoice, row };
}

/** A user in our app with a real Stripe subscription that lives on a test clock. */
async function createSubscriber(page: Page, name: string): Promise<Subscriber> {
  const email = `${name}-${run}@example.com`;
  await register(page, email);
  const [{ id: userId }] = await query<{ id: string }>("select id from users where email = $1", [email]);

  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: `storykeep dunning ${name} ${run}`,
  });
  const customer = await stripe.customers.create({
    email,
    test_clock: clock.id,
    metadata: { userId },
  });
  await query("update users set stripe_customer_id = $1 where id = $2", [customer.id, userId]);

  // pm_card_visa is Stripe's token for the test card 4242 4242 4242 4242.
  const goodCard = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: goodCard.id },
  });

  const product = await stripe.products.create({ name: `StoryKeep Life Story (dunning ${run})` });
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    metadata: { userId },
    items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: 700,
          recurring: { interval: "month" },
          product: product.id,
        },
      },
    ],
  });

  const sub = { email, clock: clock.id, customer: customer.id, subscription: subscription.id, goodCard: goodCard.id };
  await waitForDbStatus(email, ["active"]);
  return sub;
}

/** Swaps in the card that attaches fine and then fails every charge, and lets the renewal run. */
async function failTheRenewal(sub: Subscriber) {
  // pm_card_chargeCustomerFail is Stripe's token for 4000 0000 0000 0341:
  // "attaching this card succeeds, but charging it fails".
  const badCard = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", {
    customer: sub.customer,
  });
  await stripe.customers.update(sub.customer, {
    invoice_settings: { default_payment_method: badCard.id },
  });

  const subscription = await stripe.subscriptions.retrieve(sub.subscription);
  const periodEnd = subscription.items.data[0].current_period_end;
  // The renewal invoice is created at the period end and charged about an
  // hour later, so go two hours past the period end.
  await advanceClock(sub, periodEnd + 2 * HOUR);
  await waitForDbStatus(sub.email, ["past_due"]);
}

async function emailsTo(email: string): Promise<string[]> {
  const response = await fetch(
    `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  const body = (await response.json()) as { messages: { Subject: string }[] };
  return body.messages.map((message) => message.Subject);
}

async function waitForEmail(email: string, subjectPart: string) {
  await expect(async () => {
    expect((await emailsTo(email)).some((s) => s.includes(subjectPart))).toBe(true);
  }).toPass({ timeout: 30_000 });
}

test.beforeAll(async () => {
  if (!process.env.STRIPE_E2E) return;
  worker = await startMockWorker();
  writeFileSync(LOG, `# Dunning run in Stripe TEST MODE, started ${new Date().toISOString()}\n\n`);
});
test.afterAll(() => {
  worker?.kill("SIGTERM");
});

test("dunning A: a renewal fails, the user is past_due with access, then a retry succeeds", async ({
  page,
}) => {
  log("## Scenario A: failed renewal, then a retry that succeeds\n");
  const sub = await createSubscriber(page, "dunning-a");
  const main = page.locator("main:visible");
  const status = main.getByTestId("subscription-status");
  const access = main.getByTestId("subscription-access");
  await snapshot(sub, "A1. Subscribed with the card 4242 (first invoice paid)");

  await page.goto("/billing");
  await expect(status).toHaveText("active");
  await expect(page.getByText("Your last payment did not go through.")).toHaveCount(0);

  await failTheRenewal(sub);
  const failedState = await snapshot(
    sub,
    "A2. One month later: renewal charged to the card 0341, which fails",
  );
  expect(failedState.row.status).toBe("past_due");
  expect(failedState.row.grace_until).not.toBeNull();
  expect(failedState.invoice.next_payment_attempt).not.toBeNull();

  // The app: still has access, shows the banner, and sent the email.
  await page.goto("/billing");
  await expect(status).toHaveText("past_due");
  await expect(access).toHaveText("yes");
  await page.screenshot({ path: "docs/evidence/dunning-a1-past-due-billing.png", fullPage: true });
  await page.goto("/stories");
  await expect(page.getByText("Your last payment did not go through.")).toBeVisible();
  await page.screenshot({ path: "docs/evidence/dunning-a2-banner.png", fullPage: true });
  await waitForEmail(sub.email, "did not go through");
  log(`  emails in Mailpit    : ${JSON.stringify(await emailsTo(sub.email))}\n`);

  // The customer fixes their card. Stripe's next automatic retry succeeds.
  await stripe.customers.update(sub.customer, {
    invoice_settings: { default_payment_method: sub.goodCard },
  });
  await advanceClock(sub, failedState.invoice.next_payment_attempt! + HOUR);
  await waitForDbStatus(sub.email, ["active"]);
  const recovered = await snapshot(
    sub,
    "A3. Card fixed. Clock moved to Stripe's next retry, which succeeds",
  );
  expect(recovered.subscription.status).toBe("active");
  expect(recovered.row).toMatchObject({ status: "active", grace_until: null });

  await page.goto("/billing");
  await expect(status).toHaveText("active");
  await expect(access).toHaveText("yes");
  await expect(page.getByText("Your last payment did not go through.")).toHaveCount(0);
  await page.screenshot({ path: "docs/evidence/dunning-a3-recovered.png", fullPage: true });
});

test("dunning B: every retry fails, the subscription ends and access is revoked", async ({
  page,
}) => {
  log("## Scenario B: failed renewal, then every retry fails\n");
  const sub = await createSubscriber(page, "dunning-b");
  const main = page.locator("main:visible");
  const status = main.getByTestId("subscription-status");
  const access = main.getByTestId("subscription-access");
  await snapshot(sub, "B1. Subscribed with the card 4242 (first invoice paid)");

  await failTheRenewal(sub);
  let state = await snapshot(sub, "B2. One month later: renewal charged to the card 0341, which fails");
  await page.goto("/billing");
  await expect(status).toHaveText("past_due");
  await expect(access).toHaveText("yes");

  // Let every automatic retry run and fail. Stripe decides how many there are.
  let retry = 1;
  while (state.invoice.next_payment_attempt && state.subscription.status === "past_due") {
    await advanceClock(sub, state.invoice.next_payment_attempt + HOUR);
    // Give the webhooks a moment to arrive before reading our database.
    await new Promise((resolve) => setTimeout(resolve, 8000));
    state = await snapshot(sub, `B${2 + retry}. Retry ${retry} ran and failed`);
    retry += 1;
    expect(retry).toBeLessThan(10);
  }

  const ended = await waitForDbStatus(sub.email, ["canceled", "unpaid"]);
  state = await snapshot(sub, "B-end. No retries left: Stripe ended the subscription");
  expect(["canceled", "unpaid"]).toContain(state.subscription.status);
  expect(ended.grace_until).toBeNull();

  await page.goto("/billing");
  await expect(status).toHaveText(ended.status);
  await expect(access).toHaveText("no");
  await expect(page.getByText("Your last payment did not go through.")).toHaveCount(0);
  await page.screenshot({ path: "docs/evidence/dunning-b1-ended.png", fullPage: true });
  await waitForEmail(sub.email, "has ended");
  log(`  emails in Mailpit    : ${JSON.stringify(await emailsTo(sub.email))}\n`);
});
