import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/(auth)/actions";
import { requireUser } from "@/auth/guards";
import { listStoriesForUser } from "@/stories/data";
import { createStoryAction } from "./actions";

export const metadata = { title: "My stories · StoryKeep" };

const KIND_LABEL = { eulogy: "Eulogy", life_story: "Life Story" } as const;

export default function StoriesPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My stories</h1>
        <form action={logout}>
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </div>

      {/* Reading the session needs the request, so it streams in behind Suspense. */}
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <StoryList />
      </Suspense>

      <form action={createStoryAction} className="mt-10 flex flex-col gap-3">
        <h2 className="text-lg font-medium">Start a new story</h2>
        <input
          name="title"
          required
          maxLength={120}
          placeholder="Who is this story about?"
          aria-label="Title"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select
          name="kind"
          aria-label="Kind"
          defaultValue="life_story"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="life_story">Life Story</option>
          <option value="eulogy">Eulogy</option>
        </select>
        <button
          type="submit"
          className="self-start rounded bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Create story
        </button>
      </form>
    </main>
  );
}

async function StoryList() {
  const userId = await requireUser();
  const stories = await listStoriesForUser(userId);

  if (stories.length === 0) {
    return (
      <p className="mt-6 text-sm text-zinc-500">
        No stories yet. Start your first one below.
      </p>
    );
  }

  return (
    <ul className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800">
      {stories.map((story) => (
        <li key={story.id} className="flex items-center justify-between py-3">
          <Link href={`/stories/${story.id}`} className="font-medium underline">
            {story.title}
          </Link>
          <span className="text-sm text-zinc-500">{KIND_LABEL[story.kind]}</span>
        </li>
      ))}
    </ul>
  );
}
