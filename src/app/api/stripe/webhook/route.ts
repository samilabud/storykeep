import { after } from "next/server";
import type Stripe from "stripe";
import { processStripeEvent } from "@/billing/events";
import { getStripe } from "@/billing/stripe";
import { runPendingJobsQuietly } from "@/jobs/run";

export const maxDuration = 60;

/**
 * Stripe calls this URL. Anyone on the internet can call it too, so the
 * first job is to prove the request really comes from Stripe.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  // The signature is an HMAC of the exact bytes Stripe sent. So read the raw
  // text. Parsing to JSON and back would change the bytes and break it.
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const result = await processStripeEvent(event);
    // The event may have queued an email. Where there is no worker process
    // (a serverless host), send it after replying to Stripe, so a slow mail
    // server cannot make the webhook time out.
    if (process.env.VERCEL) after(runPendingJobsQuietly);
    // 200 for a duplicate too: Stripe should stop retrying it.
    return Response.json({ received: true, result });
  } catch (error) {
    // Nothing was saved (the transaction rolled back). A 500 makes Stripe
    // send the event again later.
    console.error(`[stripe] failed to process ${event.id} (${event.type})`, error);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
