import { appUrl } from "@/billing/stripe";
import type { EmailPayload } from "./outbox";

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export function paymentFailedEmail(to: string, graceUntil: Date): EmailPayload {
  return {
    to,
    subject: "Your StoryKeep payment did not go through",
    text: [
      "Hello,",
      "",
      "We could not charge your card for your StoryKeep subscription.",
      `You keep full access until ${formatDate(graceUntil)}. We will try the card again.`,
      "",
      `To update your card now, open: ${appUrl()}/billing`,
      "",
      "Your stories and answers are safe.",
      "StoryKeep",
    ].join("\n"),
  };
}

export function subscriptionEndedEmail(to: string): EmailPayload {
  return {
    to,
    subject: "Your StoryKeep subscription has ended",
    text: [
      "Hello,",
      "",
      "Your StoryKeep subscription has ended, so new drafts and downloads are paused.",
      "Your stories and answers are still saved.",
      "",
      `You can subscribe again any time: ${appUrl()}/billing`,
      "",
      "StoryKeep",
    ].join("\n"),
  };
}
