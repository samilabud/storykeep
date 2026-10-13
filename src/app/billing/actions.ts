"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth/guards";
import { createPortalUrl, startSubscriptionCheckout } from "@/billing/checkout";

export async function subscribeAction() {
  const userId = await requireUser();
  const result = await startSubscriptionCheckout(userId);
  if (result.status === "redirect") redirect(result.url);
  refresh();
}

export async function openPortalAction() {
  const userId = await requireUser();
  const url = await createPortalUrl(userId);
  if (url) redirect(url);
  refresh();
}
