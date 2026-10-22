import Link from "next/link";
import { SiteHeader } from "./site-header";
import { buttonPrimary, buttonSecondary, card, muted } from "./ui";

const STEPS = [
  {
    title: "Answer a few questions",
    body: "Nine gentle questions about their life. Skip any you like, and come back whenever you are ready.",
  },
  {
    title: "Get a first draft",
    body: "We write a draft from your answers only. Nothing is invented.",
  },
  {
    title: "Shape it with the assistant",
    body: "Ask for a warmer opening, a shorter version, or help remembering a detail. Every edit is saved as a version.",
  },
  {
    title: "Download and share",
    body: "A clean PDF to print, or a Word file to keep editing.",
  },
];

const PLANS = [
  {
    name: "Eulogy",
    price: "$9",
    period: "once",
    body: "One eulogy draft to read aloud, about 500 to 700 words. PDF and Word downloads.",
  },
  {
    name: "Life Story",
    price: "$7",
    period: "per month",
    body: "Unlimited life story drafts for the family to keep, about 800 to 1,200 words. Cancel any time.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader variant="public" />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-4xl px-4 pt-16 pb-12 text-center sm:pt-24">
          <p className="text-sm font-medium tracking-wide text-accent uppercase">
            Life stories and eulogies
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Put a life into words, gently.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-muted">
            Answer a few questions about someone&apos;s life. Get a written
            story you can edit with a caring assistant and download.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/register" className={`${buttonPrimary} px-5 py-2.5 text-base`}>
              Create account
            </Link>
            <Link href="/login" className={`${buttonSecondary} px-5 py-2.5 text-base`}>
              Sign in
            </Link>
          </div>
        </section>

        <section aria-labelledby="how" className="mx-auto w-full max-w-5xl px-4 py-12">
          <h2 id="how" className="text-center font-display text-2xl font-semibold sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className={card}>
                <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className={`mt-2 ${muted}`}>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="pricing" className="mx-auto w-full max-w-3xl px-4 pt-12 pb-20">
          <h2 id="pricing" className="text-center font-display text-2xl font-semibold sm:text-3xl">
            Simple pricing
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {PLANS.map((plan) => (
              <div key={plan.name} className={card}>
                <h3 className="font-semibold">{plan.name}</h3>
                <p className="mt-2">
                  <span className="font-display text-4xl font-semibold">{plan.price}</span>{" "}
                  <span className={muted}>{plan.period}</span>
                </p>
                <p className={`mt-3 ${muted}`}>{plan.body}</p>
              </div>
            ))}
          </div>
          <p className={`mt-6 text-center ${muted}`}>
            Your answers and every version of the story are saved as you go.
          </p>
        </section>
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        StoryKeep · Payments run in Stripe test mode.
      </footer>
    </>
  );
}
