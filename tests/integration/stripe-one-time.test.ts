import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/stripe/webhook/route";
import { processStripeEvent } from "@/billing/events";
import { getEulogyPayment } from "@/billing/orders";
import { getDb } from "@/db/client";
import { jobs, orders, stripeEvents } from "@/db/schema";
import {
  createGenerateDraftHandler,
  GENERATE_DRAFT,
} from "@/jobs/handlers/generate-draft";
import { runNextJob } from "@/jobs/worker";
import { MockLlmProvider } from "@/llm/mock";
import { LlmError } from "@/llm/provider";
import { saveAnswer } from "@/questionnaire/data";
import { createStory } from "@/stories/data";
import { requestDraft } from "@/stories/drafts";
import { listVersions } from "@/stories/versions";
import { createTestUser, resetDb } from "../helpers/db";
import { checkoutCompletedEvent, stripeEvent } from "../helpers/stripe";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const stripe = new Stripe("sk_test_fake_key_for_unit_tests");

/** A request signed the same way Stripe signs it. */
function signedRequest(event: Stripe.Event, secret = WEBHOOK_SECRET, body?: string) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: body ?? payload,
  });
}

describe("Stripe one-time payment for a eulogy", () => {
  let alice: { id: string };
  let eulogyId: string;

  const handlers = (llm = new MockLlmProvider()) => ({
    [GENERATE_DRAFT]: createGenerateDraftHandler(llm),
  });
  const allOrders = () => getDb().select().from(orders);
  const allEvents = () => getDb().select().from(stripeEvents);

  beforeEach(async () => {
    await resetDb();
    alice = await createTestUser("alice@example.com");
    eulogyId = (
      await createStory(alice.id, { title: "Grandpa Joe", kind: "eulogy" })
    ).id;
    await saveAnswer(alice.id, eulogyId, {
      questionKey: "full_name",
      answerText: "Joseph Ellis",
    });
  });

  describe("payment unlocks generation", () => {
    it("blocks a eulogy draft before payment", async () => {
      expect(await getEulogyPayment(alice.id, eulogyId)).toBe("unpaid");
      expect(await requestDraft(alice.id, eulogyId)).toEqual({
        status: "payment_required",
      });
      expect(await getDb().select().from(jobs)).toHaveLength(0);
    });

    it("allows exactly one draft after the paid webhook", async () => {
      await processStripeEvent(
        checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId }),
      );
      expect(await getEulogyPayment(alice.id, eulogyId)).toBe("paid_unused");

      expect(await requestDraft(alice.id, eulogyId)).toMatchObject({ status: "queued" });
      await runNextJob(handlers());
      expect(await listVersions(alice.id, eulogyId)).toHaveLength(1);

      // The one generation is used. A second needs a second payment.
      expect(await getEulogyPayment(alice.id, eulogyId)).toBe("paid_used");
      expect(await requestDraft(alice.id, eulogyId)).toEqual({
        status: "payment_required",
      });
    });

    it("does not unlock when the session completed but is not paid yet", async () => {
      await processStripeEvent(
        checkoutCompletedEvent({
          userId: alice.id,
          storyId: eulogyId,
          paymentStatus: "unpaid",
        }),
      );
      expect(await getEulogyPayment(alice.id, eulogyId)).toBe("unpaid");
    });

    it("turns the pending order from checkout into a paid one", async () => {
      await getDb().insert(orders).values({
        userId: alice.id,
        storyId: eulogyId,
        stripeCheckoutSessionId: "cs_test_known",
        amountCents: 900,
        status: "pending",
      });
      await processStripeEvent(
        checkoutCompletedEvent({
          userId: alice.id,
          storyId: eulogyId,
          sessionId: "cs_test_known",
        }),
      );
      const rows = await allOrders();
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("paid");
    });

    it("five draft requests at once use the single payment once", async () => {
      await processStripeEvent(
        checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId }),
      );
      const results = await Promise.all(
        Array.from({ length: 5 }, () => requestDraft(alice.id, eulogyId)),
      );
      expect(results.filter((r) => r?.status === "queued")).toHaveLength(1);
      expect(await getDb().select().from(jobs)).toHaveLength(1);
    });

    it("'try again' after a failed job does not need a second payment", async () => {
      await processStripeEvent(
        checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId }),
      );
      await requestDraft(alice.id, eulogyId);
      const failing = new MockLlmProvider({
        failTimes: 1,
        error: new LlmError("LLM_REJECTED", "Bad request", false),
      });
      expect((await runNextJob(handlers(failing)))?.status).toBe("failed");

      // The customer paid and got nothing yet, so the retry is free.
      expect(await requestDraft(alice.id, eulogyId)).toMatchObject({ status: "queued" });
      expect((await runNextJob(handlers()))?.status).toBe("succeeded");
      expect(await listVersions(alice.id, eulogyId)).toHaveLength(1);
    });

    it("a full refund removes the unused unlock", async () => {
      const paid = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });
      await processStripeEvent(paid);
      const paymentIntent = (paid.data.object as { payment_intent: string }).payment_intent;

      await processStripeEvent(
        stripeEvent("charge.refunded", {
          object: "charge",
          refunded: true,
          payment_intent: paymentIntent,
        }),
      );
      expect((await allOrders())[0].status).toBe("refunded");
      expect(await requestDraft(alice.id, eulogyId)).toEqual({
        status: "payment_required",
      });
    });

    it("a eulogy payment does not unlock a life story", async () => {
      const lifeStory = await createStory(alice.id, {
        title: "Aunt Rosa",
        kind: "life_story",
      });
      await saveAnswer(alice.id, lifeStory.id, {
        questionKey: "full_name",
        answerText: "Rosa",
      });
      await processStripeEvent(
        checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId }),
      );
      expect(await requestDraft(alice.id, lifeStory.id)).toEqual({
        status: "subscription_required",
      });
    });
  });

  describe("replayed events", () => {
    it("the same checkout.session.completed twice gives one order and one unlock", async () => {
      const event = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });

      expect(await processStripeEvent(event)).toBe("processed");
      expect(await processStripeEvent(event)).toBe("duplicate");

      expect(await allOrders()).toHaveLength(1);
      expect(await allEvents()).toHaveLength(1);

      // One unlock: the first draft is allowed, the second is not.
      expect(await requestDraft(alice.id, eulogyId)).toMatchObject({ status: "queued" });
      await runNextJob(handlers());
      expect(await requestDraft(alice.id, eulogyId)).toEqual({
        status: "payment_required",
      });
    });

    it("a replay after the unlock was used does not give a second unlock", async () => {
      const event = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });
      await processStripeEvent(event);
      await requestDraft(alice.id, eulogyId);
      await runNextJob(handlers());

      expect(await processStripeEvent(event)).toBe("duplicate");
      expect(await getEulogyPayment(alice.id, eulogyId)).toBe("paid_used");
    });

    it("the same event delivered five times at once is processed once", async () => {
      const event = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => processStripeEvent(event)),
      );
      expect(results.filter((r) => r === "processed")).toHaveLength(1);
      expect(results.filter((r) => r === "duplicate")).toHaveLength(4);
      expect(await allOrders()).toHaveLength(1);
    });

    it("a different event for the same session still gives one order", async () => {
      const sessionId = "cs_test_same_session";
      await processStripeEvent(
        checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId, sessionId }),
      );
      // A new event id, so the events table lets it through. The UNIQUE
      // session id on orders is the second guard.
      await processStripeEvent(
        checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId, sessionId }),
      );
      expect(await allEvents()).toHaveLength(2);
      expect(await allOrders()).toHaveLength(1);
    });

    it("a handler error rolls the event back, so Stripe's retry can succeed", async () => {
      const event = checkoutCompletedEvent({
        userId: "00000000-0000-4000-8000-000000000000", // no such user
        storyId: eulogyId,
        eventId: "evt_test_will_fail_then_work",
      });
      await expect(processStripeEvent(event)).rejects.toThrow();
      expect(await allEvents()).toHaveLength(0); // not marked as seen

      const fixed = checkoutCompletedEvent({
        userId: alice.id,
        storyId: eulogyId,
        eventId: "evt_test_will_fail_then_work",
      });
      expect(await processStripeEvent(fixed)).toBe("processed");
    });

    it("stores event types it does not handle and changes nothing else", async () => {
      expect(await processStripeEvent(stripeEvent("customer.created", {}))).toBe("processed");
      expect(await allEvents()).toHaveLength(1);
      expect(await allOrders()).toHaveLength(0);
    });
  });

  describe("webhook endpoint: signature verification", () => {
    it("accepts a correctly signed event and marks the order paid", async () => {
      const event = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });
      const response = await POST(signedRequest(event));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true, result: "processed" });
      expect((await allOrders())[0].status).toBe("paid");
    });

    it("answers 200 'duplicate' when Stripe sends the same event again", async () => {
      const event = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });
      await POST(signedRequest(event));
      const second = await POST(signedRequest(event));

      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ received: true, result: "duplicate" });
      expect(await allOrders()).toHaveLength(1);
    });

    it("rejects a request with no signature header", async () => {
      const event = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });
      const response = await POST(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          body: JSON.stringify(event),
        }),
      );
      expect(response.status).toBe(400);
      expect(await allOrders()).toHaveLength(0);
      expect(await allEvents()).toHaveLength(0);
    });

    it("rejects an event signed with the wrong secret", async () => {
      const event = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });
      const response = await POST(signedRequest(event, "whsec_attacker_guess"));
      expect(response.status).toBe(400);
      expect(await allOrders()).toHaveLength(0);
    });

    it("rejects a body that was changed after signing", async () => {
      const event = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });
      const bob = await createTestUser("bob@example.com");
      // An attacker keeps the valid signature but swaps in their own user id.
      const tampered = JSON.stringify(event).replace(alice.id, bob.id);
      const response = await POST(signedRequest(event, WEBHOOK_SECRET, tampered));

      expect(response.status).toBe(400);
      expect(await allOrders()).toHaveLength(0);
    });

    it("rejects a signature with an old timestamp (replay of a captured request)", async () => {
      const event = checkoutCompletedEvent({ userId: alice.id, storyId: eulogyId });
      const payload = JSON.stringify(event);
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
      const signature = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
        timestamp: tenMinutesAgo,
      });
      const response = await POST(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: payload,
        }),
      );
      expect(response.status).toBe(400);
    });

    it("answers 500 when processing fails, so Stripe retries", async () => {
      const event = checkoutCompletedEvent({
        userId: "00000000-0000-4000-8000-000000000000",
        storyId: eulogyId,
      });
      const response = await POST(signedRequest(event));
      expect(response.status).toBe(500);
      expect(await allEvents()).toHaveLength(0);
    });
  });
});
