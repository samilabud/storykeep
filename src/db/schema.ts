import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const storyKind = pgEnum("story_kind", ["eulogy", "life_story"]);
export const versionSource = pgEnum("version_source", [
  "llm_draft",
  "user_edit",
]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "refunded",
]);
export const subscriptionStatus = pgEnum("subscription_status", [
  "incomplete",
  "active",
  "past_due",
  "canceled",
  "unpaid",
]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  createdAt: createdAt(),
});

export const stories = pgTable(
  "stories",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: storyKind("kind").notNull(),
    title: text("title").notNull(),
    // Points at the version the user sees. No FK: story_versions already
    // references stories, and a two-way FK makes inserts awkward.
    currentVersionId: uuid("current_version_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("stories_user_id_idx").on(t.userId)],
);

// Answers are append-only. A changed answer is a new row with revision + 1,
// so the history is never lost.
export const questionnaireAnswers = pgTable(
  "questionnaire_answers",
  {
    id: id(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    answerText: text("answer_text"),
    skipped: boolean("skipped").notNull().default(false),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    unique("questionnaire_answers_story_question_revision_uq").on(
      t.storyId,
      t.questionKey,
      t.revision,
    ),
  ],
);

export const storyVersions = pgTable(
  "story_versions",
  {
    id: id(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    source: versionSource("source").notNull(),
    content: text("content").notNull(),
    // Set for LLM drafts. A retried job hits this UNIQUE and inserts nothing.
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("story_versions_story_version_no_uq").on(t.storyId, t.versionNo),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_status_run_at_idx").on(t.status, t.runAt)],
);

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costCents: integer("cost_cents").notNull(),
    day: date("day").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("llm_usage_user_day_idx").on(t.userId, t.day)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => stories.id, {
      onDelete: "set null",
    }),
    stripeCheckoutSessionId: text("stripe_checkout_session_id")
      .notNull()
      .unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: orderStatus("status").notNull().default("pending"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("orders_user_id_idx").on(t.userId)],
);

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  status: subscriptionStatus("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  graceUntil: timestamp("grace_until", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  // Two "watermarks" for events that arrive out of order.
  // Stripe's `created` time of the newest subscription snapshot we applied.
  // An older snapshot that arrives late is ignored.
  lastEventCreatedAt: timestamp("last_event_created_at", {
    withTimezone: true,
  }),
  // `created` time of the newest invoice.paid we saw. A payment failure
  // older than this was already recovered and is ignored.
  lastPaidEventAt: timestamp("last_paid_event_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// The primary key is Stripe's own event id. A replayed event fails the insert,
// so we skip it.
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  created: timestamp("created", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});
