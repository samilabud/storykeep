import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { llmUsage } from "@/db/schema";
import type { DraftResult } from "./provider";

/** Each user may spend this much on LLM calls per UTC day. Default: $1. */
export function dailyCapCents(): number {
  return Number(process.env.LLM_DAILY_COST_CAP_CENTS ?? 100);
}

/** The calendar day in UTC, as YYYY-MM-DD. */
export function usageDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function spentTodayCents(userId: string, now: Date): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${llmUsage.costCents}), 0)::int` })
    .from(llmUsage)
    .where(and(eq(llmUsage.userId, userId), eq(llmUsage.day, usageDay(now))));
  return row.total;
}

export async function isOverDailyCap(userId: string, now: Date): Promise<boolean> {
  return (await spentTodayCents(userId, now)) >= dailyCapCents();
}

/** One row per LLM call that returned. This table is what the cap sums. */
export async function recordUsage(
  userId: string,
  jobId: string | null,
  result: DraftResult,
  now: Date,
): Promise<void> {
  await getDb().insert(llmUsage).values({
    userId,
    jobId,
    provider: result.provider,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costCents: result.costCents,
    day: usageDay(now),
  });
}
