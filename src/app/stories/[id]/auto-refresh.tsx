"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * While a draft is being written, ask the server for fresh data every two
 * seconds. Rendered only while a job is queued or running, so the polling
 * stops by itself when the job ends.
 */
export function AutoRefresh({ everyMs = 2000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
