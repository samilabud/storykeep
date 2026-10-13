import nodemailer from "nodemailer";
import * as z from "zod";
import type { EmailPayload } from "@/email/outbox";
import { JobError } from "../queue";
import type { JobHandler } from "../worker";

const payloadSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string().min(1),
});

export type Mailer = (email: EmailPayload) => Promise<void>;

/** Sends through SMTP. Locally that is Mailpit, which only stores the mail. */
export function createSmtpMailer(): Mailer {
  const transport = nodemailer.createTransport(
    process.env.SMTP_URL ?? "smtp://localhost:1025",
  );
  const from = process.env.EMAIL_FROM ?? "StoryKeep <billing@storykeep.test>";
  return async (email) => {
    await transport.sendMail({ from, ...email });
  };
}

/**
 * The mailer for this environment. With no SMTP_URL on a deployed host there
 * is nowhere to send mail, so the email is written to the log instead of
 * failing the job. Locally the default is Mailpit on port 1025.
 */
export function createMailer(): Mailer {
  if (!process.env.SMTP_URL && process.env.VERCEL) {
    return async (email) => {
      console.log(`[email] (no SMTP configured) to=${email.to} subject="${email.subject}"`);
    };
  }
  return createSmtpMailer();
}

/**
 * Delivery is at-least-once, like every job. If the worker dies right after
 * the SMTP server accepted the mail, the retry sends it a second time. For a
 * "payment failed" notice that is acceptable. It is not acceptable to lose it.
 */
export function createSendEmailHandler(send: Mailer): JobHandler {
  return async (job) => {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new JobError("BAD_PAYLOAD", "Email payload is not valid", false);
    }
    try {
      await send(parsed.data);
    } catch (error) {
      // SMTP problems are usually temporary. Let the queue retry.
      throw new JobError("SMTP_FAILED", "Could not send the email", true, {
        cause: error,
      });
    }
  };
}
