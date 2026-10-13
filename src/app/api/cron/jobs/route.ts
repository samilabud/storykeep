import { runPendingJobs } from "@/jobs/run";

export const maxDuration = 60;

/**
 * Safety net for hosts without a worker process. A scheduler calls this URL
 * and it runs whatever is waiting (for example a retry whose delay has
 * passed, or a job left behind by a function that timed out).
 *
 * Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Without the right
 * secret the route does nothing, so strangers cannot trigger it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runPendingJobs(20);
  return Response.json({
    ran: results.length,
    results: results.map(({ type, status }) => ({ type, status })),
  });
}
