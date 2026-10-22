// Shared Tailwind class strings, so every page uses the same buttons, cards
// and fields. Plain strings, not components: they work in server and client
// components alike and on <a>, <Link> and <button>.

const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export const buttonPrimary = `inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${focus}`;

export const buttonSecondary = `inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 ${focus}`;

export const card = "rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6";

export const field =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

export const textLink = `underline decoration-line underline-offset-4 transition hover:text-accent hover:decoration-accent ${focus}`;

export const backLink = `inline-flex items-center gap-1 text-sm text-muted transition hover:text-accent ${focus}`;

export const pageTitle = "font-display text-3xl font-semibold tracking-tight sm:text-4xl";

export const sectionTitle = "text-lg font-semibold";

export const muted = "text-sm text-muted";

export const badge =
  "inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent";
