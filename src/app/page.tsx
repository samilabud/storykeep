import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">StoryKeep</h1>
      <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
        Answer a few questions about someone&apos;s life. Get a written story
        you can edit and download.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/register"
          className="rounded bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="rounded border border-zinc-300 px-4 py-2 font-medium dark:border-zinc-700"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
