import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/auth/guards";
import { listStoriesForUser } from "@/stories/data";
import { SiteHeader } from "../site-header";
import { badge, buttonPrimary, card, field, muted, pageTitle, sectionTitle } from "../ui";
import { createStoryAction } from "./actions";

export const metadata = { title: "My stories · StoryKeep" };

const KIND_LABEL = { eulogy: "Eulogy", life_story: "Life Story" } as const;

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function StoriesPage() {
  return (
    <>
      <SiteHeader variant="app" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className={pageTitle}>My stories</h1>
        <p className={`mt-2 ${muted}`}>
          Each story keeps its answers and every version of the text.
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
          {/* Reading the session needs the request, so it streams in behind Suspense. */}
          <Suspense fallback={<StoryListSkeleton />}>
            <StoryList />
          </Suspense>

          <form
            action={createStoryAction}
            className={`${card} flex flex-col gap-4 self-start lg:sticky lg:top-6`}
          >
            <h2 className={sectionTitle}>Start a new story</h2>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Title
              <input
                name="title"
                required
                maxLength={120}
                placeholder="Who is this story about?"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Kind
              <select name="kind" defaultValue="life_story" className={field}>
                <option value="life_story">Life Story</option>
                <option value="eulogy">Eulogy</option>
              </select>
            </label>
            <p className="text-xs text-muted">
              A life story is for the family to keep. A eulogy is written to be
              read aloud.
            </p>
            <button type="submit" className={buttonPrimary}>
              Create story
            </button>
          </form>
        </div>
      </main>
    </>
  );
}

function StoryListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading stories" className="grid gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl border border-line bg-surface" />
      ))}
    </div>
  );
}

async function StoryList() {
  const userId = await requireUser();
  const stories = await listStoriesForUser(userId);

  if (stories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
        <p className="font-display text-xl font-semibold">No stories yet</p>
        <p className={`mt-2 max-w-sm ${muted}`}>
          Start your first one with the form. It only needs a name.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid content-start gap-3 sm:grid-cols-2">
      {stories.map((story) => (
        <li key={story.id}>
          <Link
            href={`/stories/${story.id}`}
            className={`${card} group flex h-full flex-col gap-3 transition hover:border-accent hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-display text-lg font-semibold group-hover:text-accent">
                {story.title}
              </span>
              <span className={`${badge} shrink-0`}>{KIND_LABEL[story.kind]}</span>
            </div>
            <span className="mt-auto flex items-center justify-between text-xs text-muted">
              <span>{story.currentVersionId ? "Has a draft" : "No text yet"}</span>
              <span>Updated {formatDate(story.updatedAt)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
