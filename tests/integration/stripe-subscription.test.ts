import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { processStripeEvent } from "@/billing/events";
import { GRACE_PERIOD_MS } from "@/billing/state-machine";
import { getSubscriptionView } from "@/billing/subscriptions";
import { getDb } from "@/db/client";
import { jobs, subscriptions, users } from "@/db/schema";
import { SEND_EMAIL, type EmailPayload } from "@/email/outbox";
import { createSendEmailHandler } from "@/jobs/handlers/send-email";
import { runNextJob } from "@/jobs/worker";
import { saveAnswer } from "@/questionnaire/data";
import { createStory } from "@/stories/data";
import { requestDraft } from "@/stories/drafts";
import { createTestUser, resetDb } from "../helpers/db";
import { invoiceEvent, subscriptionEvent } from "../helpers/stripe";

const DAY = 24 * 60 * 60;
const T0 = Math.floor(Date.UTC(2026, 9, 1) / 1000); // Stripe times are in seconds
const MONTH = 30 * DAY;
const date = (seconds: number) => new Date(seconds * 1000);
const CUSTOMER = "cus_test_alice";

describe("Stripe subscription and dunning", () => {
  let alice: { id: string; email: string };
  let storyId: string;

  const sub = (
    type: "created" | "updated" | "deleted",
    status: string,
    at: number,
    extra: Partial<Parameters<typeof subscriptionEvent>[1]> = {},
  ) => subscriptionEvent(type, { customerId: CUSTOMER, status, at, ...extra });
  const paid = (at: number) =>
    invoiceEvent("paid", { customerId: CUSTOMER, at });
  const failed = (at: number, attemptCount = 1) =>
    invoiceEvent("payment_failed", { customerId: CUSTOMER, at, attemptCount });

  const deliver = async (events: Stripe.Event[]) => {
    for (const event of events) await processStripeEvent(event);
  };
  const row = async () =>
    (await getDb().select().from(subscriptions).where(eq(subscriptions.userId, alice.id)))[0];
  const emailJobs = async () =>
    (await getDb().select().from(jobs).where(eq(jobs.type, SEND_EMAIL))).map(
      (job) => job.payload as EmailPayload,
    );
  const canDraft = async (now: Date) =>
    (await requestDraft(alice.id, storyId, now))?.status;

  // The events of each stage, in the order Stripe normally sends them.
  const signup = [
    sub("created", "incomplete", T0),
    paid(T0 + 2),
    sub("updated", "active", T0 + 2),
  ];
  const renewalFails = [
    failed(T0 + MONTH),
    sub("updated", "past_due", T0 + MONTH, { periodEnd: T0 + 2 * MONTH }),
  ];
  const retrySucceeds = [
    paid(T0 + MONTH + 2 * DAY),
    sub("updated", "active", T0 + MONTH + 2 * DAY, { periodEnd: T0 + 2 * MONTH }),
  ];

  beforeEach(async () => {
    await resetDb();
    alice = await createTestUser("alice@example.com");
    await getDb()
      .update(users)
      .set({ stripeCustomerId: CUSTOMER })
      .where(eq(users.id, alice.id));
    storyId = (
      await createStory(alice.id, { title: "Aunt Rosa", kind: "life_story" })
    ).id;
    await saveAnswer(alice.id, storyId, {
      questionKey: "full_name",
      answerText: "Rosa",
    });
  });

  describe("access follows the webhook-fed state", () => {
    it("no subscription: a life story draft is refused", async () => {
      expect(await canDraft(date(T0))).toBe("subscription_required");
      expect((await getSubscriptionView(alice.id, date(T0))).hasAccess).toBe(false);
    });

    it("after signup: active, and drafts are allowed", async () => {
      await deliver(signup);
      expect(await row()).toMatchObject({ status: "active", graceUntil: null });
      expect(await canDraft(date(T0 + DAY))).toBe("queued");
    });

    it("finds the user by metadata when the customer id is not stored yet", async () => {
      await getDb().update(users).set({ stripeCustomerId: null }).where(eq(users.id, alice.id));
      await processStripeEvent(sub("created", "active", T0, { userId: alice.id }));
      expect((await row()).status).toBe("active");
    });

    it("ignores a subscription that belongs to no user of ours", async () => {
      await processStripeEvent(
        subscriptionEvent("created", { customerId: "cus_someone_else", status: "active", at: T0 }),
      );
      expect(await getDb().select().from(subscriptions)).toHaveLength(0);
    });
  });

  describe("dunning: active -> past_due -> recovered or ended", () => {
    it("a failed renewal gives past_due, a 3 day grace period and one email", async () => {
      await deliver([...signup, ...renewalFails]);

      const state = await row();
      expect(state.status).toBe("past_due");
      expect(state.graceUntil).toEqual(new Date(date(T0 + MONTH).getTime() + GRACE_PERIOD_MS));

      const emails = await emailJobs();
      expect(emails).toHaveLength(1);
      expect(emails[0]).toMatchObject({
        to: "alice@example.com",
        subject: "Your StoryKeep payment did not go through",
      });
      expect(emails[0].text).toContain("until November 3, 2026");
    });

    it("inside the grace period the user keeps access", async () => {
      await deliver([...signup, ...renewalFails]);
      const dayTwo = date(T0 + MONTH + 2 * DAY);

      const view = await getSubscriptionView(alice.id, dayTwo);
      expect(view.hasAccess).toBe(true);
      expect(view.graceUntil).not.toBeNull(); // this is what shows the banner
      expect(await canDraft(dayTwo)).toBe("queued");
    });

    it("when the grace period ends, access stops with no new event", async () => {
      await deliver([...signup, ...renewalFails]);
      const dayFour = date(T0 + MONTH + 4 * DAY);

      expect((await row()).status).toBe("past_due"); // Stripe is still retrying
      expect((await getSubscriptionView(alice.id, dayFour)).hasAccess).toBe(false);
      expect(await canDraft(dayFour)).toBe("subscription_required");
    });

    it("a retry that succeeds restores active and clears the grace period", async () => {
      await deliver([...signup, ...renewalFails, ...retrySucceeds]);

      expect(await row()).toMatchObject({ status: "active", graceUntil: null });
      expect(await canDraft(date(T0 + MONTH + 5 * DAY))).toBe("queued");
    });

    it("a late retry that succeeds after the grace period gives access back", async () => {
      const lateRecovery = [
        paid(T0 + MONTH + 6 * DAY),
        sub("updated", "active", T0 + MONTH + 6 * DAY),
      ];
      await deliver([...signup, ...renewalFails]);
      expect(await canDraft(date(T0 + MONTH + 5 * DAY))).toBe("subscription_required");

      await deliver(lateRecovery);
      expect(await canDraft(date(T0 + MONTH + 7 * DAY))).toBe("queued");
    });

    it("a final failure cancels, revokes access and sends the 'ended' email", async () => {
      await deliver([
        ...signup,
        ...renewalFails,
        failed(T0 + MONTH + 3 * DAY, 2),
        failed(T0 + MONTH + 8 * DAY, 3),
        sub("deleted", "canceled", T0 + MONTH + 8 * DAY),
      ]);

      expect(await row()).toMatchObject({ status: "canceled", graceUntil: null });
      expect(await canDraft(date(T0 + MONTH + 8 * DAY))).toBe("subscription_required");

      const subjects = (await emailJobs()).map((email) => email.subject);
      expect(subjects.filter((s) => s.includes("did not go through"))).toHaveLength(3);
      expect(subjects.filter((s) => s.includes("has ended"))).toHaveLength(1);
    });

    it("'unpaid' (another Stripe setting for a final failure) also revokes access", async () => {
      await deliver([...signup, ...renewalFails, sub("updated", "unpaid", T0 + MONTH + 8 * DAY)]);
      expect((await row()).status).toBe("unpaid");
      expect(await canDraft(date(T0 + MONTH + 8 * DAY))).toBe("subscription_required");
    });

    it("cancel at period end keeps access until Stripe deletes the subscription", async () => {
      await deliver([
        ...signup,
        sub("updated", "active", T0 + 5 * DAY, { cancelAtPeriodEnd: true }),
      ]);
      expect(await row()).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
      expect(await canDraft(date(T0 + 10 * DAY))).toBe("queued");

      await processStripeEvent(sub("deleted", "canceled", T0 + MONTH));
      expect((await getSubscriptionView(alice.id, date(T0 + MONTH))).hasAccess).toBe(false);
    });
  });

  describe("out-of-order webhooks", () => {
    it("invoice.paid before subscription.updated ends active", async () => {
      // The row exists (created), then paid, then the snapshot that says active.
      await deliver([sub("created", "incomplete", T0), paid(T0 + 2), sub("updated", "active", T0 + 2)]);
      expect((await row()).status).toBe("active");
    });

    it("invoice.paid before the subscription exists at all ends active", async () => {
      await deliver([paid(T0 + 2), sub("updated", "active", T0 + 2), sub("created", "incomplete", T0)]);
      expect((await row()).status).toBe("active");
    });

    it("recovery: invoice.paid arrives before the late past_due snapshot", async () => {
      await deliver([
        ...signup,
        failed(T0 + MONTH),
        paid(T0 + MONTH + 2 * DAY), // recovery arrives first
        sub("updated", "past_due", T0 + MONTH), // the old snapshot arrives late
        sub("updated", "active", T0 + MONTH + 2 * DAY),
      ]);
      expect(await row()).toMatchObject({ status: "active", graceUntil: null });
    });

    it("a late payment_failed after recovery does not reopen dunning or send an email", async () => {
      await deliver([...signup, ...retrySucceeds, failed(T0 + MONTH)]);
      expect(await row()).toMatchObject({ status: "active", graceUntil: null });
      expect(await emailJobs()).toHaveLength(0);
    });

    it("events after 'deleted' do not bring the subscription back", async () => {
      await deliver([
        ...signup,
        sub("deleted", "canceled", T0 + 5 * DAY),
        sub("updated", "active", T0 + 4 * DAY), // late
        paid(T0 + 4 * DAY), // late
      ]);
      expect((await row()).status).toBe("canceled");
    });

    it("the whole recovery story fully reversed still ends active", async () => {
      await deliver([...signup, ...renewalFails, ...retrySucceeds].reverse());
      expect(await row()).toMatchObject({ status: "active", graceUntil: null });
    });
  });

  describe("replays and emails", () => {
    it("a replayed invoice.payment_failed does not send a second email", async () => {
      const failure = invoiceEvent("payment_failed", {
        customerId: CUSTOMER,
        at: T0 + MONTH,
        eventId: "evt_test_failed_once",
      });
      await deliver([...signup, failure, failure, failure]);
      expect(await emailJobs()).toHaveLength(1);
    });

    it("two different events for the same failed attempt still send one email", async () => {
      // Different event ids pass the events table. The email's own key
      // (invoice id + attempt number) is the second guard.
      await deliver([...signup, failed(T0 + MONTH, 1), failed(T0 + MONTH + 1, 1)]);
      expect(await emailJobs()).toHaveLength(1);
    });

    it("the worker sends the queued email", async () => {
      await deliver([...signup, ...renewalFails]);

      const sent: EmailPayload[] = [];
      const handlers = {
        [SEND_EMAIL]: createSendEmailHandler(async (email) => void sent.push(email)),
      };
      expect((await runNextJob(handlers))?.status).toBe("succeeded");
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe("alice@example.com");
      expect(await runNextJob(handlers)).toBeNull(); // nothing left to send
    });

    it("a worker that does not know the email job leaves it for one that does", async () => {
      await deliver([...signup, ...renewalFails]);

      // An old worker, deployed before emails existed: no email handler.
      expect(await runNextJob({})).toBeNull();
      const [job] = await getDb().select().from(jobs).where(eq(jobs.type, SEND_EMAIL));
      expect(job).toMatchObject({ status: "queued", attempts: 0 });
    });

    it("an SMTP failure is retried by the queue", async () => {
      await deliver([...signup, ...renewalFails]);
      const handlers = {
        [SEND_EMAIL]: createSendEmailHandler(async () => {
          throw new Error("connection refused");
        }),
      };
      expect((await runNextJob(handlers))?.status).toBe("queued");
    });
  });

  describe("subscribing again", () => {
    it("a new subscription after cancel replaces the old one", async () => {
      await deliver([
        ...signup,
        sub("deleted", "canceled", T0 + 5 * DAY),
        sub("created", "active", T0 + 9 * DAY, { subscriptionId: "sub_test_2" }),
      ]);
      expect(await row()).toMatchObject({
        stripeSubscriptionId: "sub_test_2",
        status: "active",
      });
      expect(await getDb().select().from(subscriptions)).toHaveLength(1);
    });
  });
});
