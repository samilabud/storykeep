import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });

// Browser tests run against the dev database. These helpers read and write a
// few rows directly, for things the UI cannot do (such as "this user already
// has a subscription") and for checking state after webhooks.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query<T extends object>(text: string, values: unknown[] = []) {
  return (await pool.query(text, values)).rows as T[];
}

/** Gives a user an active subscription without going through Stripe. */
export async function seedActiveSubscription(email: string) {
  await pool.query(
    `insert into subscriptions (user_id, stripe_subscription_id, status)
     select id, 'sub_e2e_seed_' || id, 'active' from users where email = $1`,
    [email],
  );
}
