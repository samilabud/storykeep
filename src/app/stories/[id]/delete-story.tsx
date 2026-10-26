"use client";

import { useState } from "react";
import { SubmitButton } from "@/app/submit-button";
import { buttonDanger, buttonSecondary, muted } from "@/app/ui";

/**
 * Deleting cannot be undone, so it takes two clicks: the first only asks.
 */
export function DeleteStory({
  action,
  warning,
}: {
  action: () => Promise<void>;
  warning?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={buttonSecondary}>
        Delete story
      </button>
    );
  }

  return (
    <form action={action} role="alertdialog" aria-label="Confirm delete">
      <p className={muted}>
        This deletes the story, its answers and every version for good. It
        cannot be undone.
      </p>
      {warning && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {warning}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <SubmitButton className={buttonDanger} pendingLabel="Deleting…">
          Delete forever
        </SubmitButton>
        <button type="button" onClick={() => setConfirming(false)} className={buttonSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
