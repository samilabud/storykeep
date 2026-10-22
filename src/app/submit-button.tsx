"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that disables itself while its form's Server Action runs,
 * so a slow network cannot send the same form twice.
 */
export function SubmitButton({
  pendingLabel,
  children,
  ...props
}: ComponentProps<"button"> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} {...props}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
