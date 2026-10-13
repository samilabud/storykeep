import { spawn, type ChildProcess } from "node:child_process";

/**
 * Starts a real worker process with the mock model and waits until it is
 * ready. `delayMs` makes each draft take that long.
 */
export async function startMockWorker(delayMs = 0): Promise<ChildProcess> {
  const worker = spawn("pnpm", ["worker"], {
    env: { ...process.env, LLM_PROVIDER: "mock", MOCK_LLM_DELAY_MS: String(delayMs) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    worker.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("[worker] started")) resolve();
    });
    worker.on("exit", () => reject(new Error("worker exited before it started")));
  });
  return worker;
}
