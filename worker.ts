// The background worker. Run it next to the web app:  pnpm worker
//
// It is a separate process on purpose. The web request only inserts a row in
// `jobs`. This loop does the slow work, so a draft is still written when the
// user closes the browser tab or the web server restarts.

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const POLL_MS = 1000;

async function main() {
  // Imported after dotenv so these modules see the environment.
  const { createGenerateDraftHandler, GENERATE_DRAFT } = await import(
    "@/jobs/handlers/generate-draft"
  );
  const { createMailer, createSendEmailHandler } = await import(
    "@/jobs/handlers/send-email"
  );
  const { SEND_EMAIL } = await import("@/email/outbox");
  const { runNextJob } = await import("@/jobs/worker");
  const { getLlmProvider } = await import("@/llm/provider");

  const llm = await getLlmProvider();
  const handlers = {
    [GENERATE_DRAFT]: createGenerateDraftHandler(llm),
    [SEND_EMAIL]: createSendEmailHandler(createMailer()),
  };
  console.log(`[worker] started, LLM provider: ${llm.name}`);

  let stopping = false;
  const stop = () => {
    // Finish the current job, then exit. A job cut off halfway would be
    // picked up again later anyway, because jobs are idempotent.
    console.log("[worker] stopping after the current job");
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    try {
      const result = await runNextJob(handlers);
      if (result) {
        console.log(`[worker] ${result.type} ${result.jobId} -> ${result.status}`);
        continue; // look for the next job right away
      }
    } catch (error) {
      // For example the database is down. Log it and keep polling.
      console.error("[worker] loop error:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  process.exit(0);
}

main();
