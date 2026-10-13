import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { subscriptions, users } from "@/db/schema";

/** Empties every table so each test starts clean. */
export async function resetDb() {
  await getDb().execute(sql`
    TRUNCATE users, stories, questionnaire_answers, story_versions, jobs,
             llm_usage, orders, subscriptions, stripe_events
    RESTART IDENTITY CASCADE
  `);
}

export async function createTestUser(email: string) {
  const [user] = await getDb()
    .insert(users)
    // The hash is a placeholder. These tests never log in with a password.
    .values({ email, passwordHash: "not-a-real-hash" })
    .returning();
  return user;
}

/** Gives a user an active subscription without going through Stripe. */
export async function giveActiveSubscription(userId: string) {
  await getDb().insert(subscriptions).values({
    userId,
    stripeSubscriptionId: `sub_test_seed_${userId}`,
    status: "active",
  });
}
