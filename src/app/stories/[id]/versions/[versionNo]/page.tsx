import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireStoryOwner } from "@/auth/guards";
import { getVersion } from "@/stories/versions";
import { restoreVersionAction } from "../../actions";

type Props = PageProps<"/stories/[id]/versions/[versionNo]">;

export default function VersionPage({ params }: Props) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <VersionDetail params={params} />
      </Suspense>
    </main>
  );
}

async function VersionDetail({ params }: Pick<Props, "params">) {
  const { id, versionNo } = await params;
  const story = await requireStoryOwner(id);
  const version = await getVersion(story.userId, story.id, Number(versionNo));
  if (!version) notFound();

  const isCurrent = version.id === story.currentVersionId;

  return (
    <>
      <Link href={`/stories/${story.id}`} className="text-sm underline">
        ← {story.title}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">
        Version {version.versionNo}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {version.source === "llm_draft" ? "AI draft" : "Your edit"}
        {isCurrent && " · current"}
      </p>

      <article className="mt-6 whitespace-pre-wrap rounded border border-zinc-200 p-4 dark:border-zinc-800">
        {version.content}
      </article>

      {!isCurrent && (
        <form
          action={restoreVersionAction.bind(null, story.id, version.versionNo)}
          className="mt-4"
        >
          <button
            type="submit"
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Restore this version
          </button>
        </form>
      )}
    </>
  );
}
