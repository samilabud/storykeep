import { jobs } from "@/db/schema";
import type { Tx } from "@/stories/data";

export const SEND_EMAIL = "send_email";

export type EmailPayload = { to: string; subject: string; text: string };

/**
 * Queues an email inside the caller's transaction ("transactional outbox").
 *
 * Sending the email directly from the webhook would be wrong twice: if the
 * transaction then rolled back, the user would get an email about a change
 * that never happened, and Stripe's retry would send it again. Here the email
 * is a row in `jobs`. It commits or rolls back together with the state
 * change, and the unique key means a repeated event queues nothing new.
 */
export async function queueEmail(
  tx: Tx,
  idempotencyKey: string,
  email: EmailPayload,
): Promise<void> {
  await tx
    .insert(jobs)
    .values({ type: SEND_EMAIL, payload: email, idempotencyKey })
    .onConflictDoNothing({ target: jobs.idempotencyKey });
}
