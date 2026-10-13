import Link from "next/link";
import { Suspense } from "react";
import { requireStoryOwner } from "@/auth/guards";

export default function StoryPage({ params }: PageProps<"/stories/[id]">) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/stories" className="text-sm underline">
        ← My stories
      </Link>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <StoryDetail params={params} />
      </Suspense>
    </main>
  );
}

async function StoryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = await requireStoryOwner(id);

  return (
    <>
      <h1 className="mt-4 text-2xl font-semibold">{story.title}</h1>
      <p className="mt-2 text-sm text-zinc-500">
        {story.kind === "eulogy" ? "Eulogy" : "Life Story"} · the questionnaire
        arrives in the next milestone.
      </p>
    </>
  );
}
