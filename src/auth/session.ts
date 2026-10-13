import { connection } from "next/server";
import { auth } from "./config";

/**
 * Reads the current session. This is the single place the app touches Auth.js
 * for reads, so tests can replace this one module.
 */
export async function getSession() {
  // Tell Next.js this needs a live request. Without it, Next.js tries to
  // prerender the page at build time, where there is no cookie to read.
  await connection();
  return auth();
}
