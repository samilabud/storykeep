import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireStoryOwner } from "@/auth/guards";
import { getVersion } from "@/stories/versions";
import { SiteHeader } from "@/app/site-header";
import { SubmitButton } from "@/app/submit-button";
import { backLink, buttonPrimary, card, muted, pageTitle } from "@/app/ui";
import { restoreVersionAction } from "../../actions";

type Props = PageProps<"/stories/[id]/versions/[versionNo]">;

export default function VersionPage({ params }: Props) {
  return (
    <>
      <SiteHeader variant="app" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Suspense fallback={<p className={muted}>Loading…</p>}>
          <VersionDetail params={params} />
        </Suspense>
      </main>
    </>
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
      <Link href={`/stories/${story.id}`} className={backLink}>
        ← {story.title}
      </Link>
      <h1 className={`mt-4 ${pageTitle}`}>
        Version {version.versionNo}
      </h1>
      <p className={`mt-1 ${muted}`}>
        {version.source === "llm_draft" ? "AI draft" : "Your edit"}
        {isCurrent && " · current"}
      </p>

      <article className={`${card} mt-6 font-display text-[1.05rem] leading-relaxed whitespace-pre-wrap`}>
        {version.content}
      </article>

      {!isCurrent && (
        <form
          action={restoreVersionAction.bind(null, story.id, version.versionNo)}
          className="mt-4"
        >
          <p className={`mb-3 ${muted}`}>
            Restoring copies this text into a new version. Nothing is lost.
          </p>
          <SubmitButton className={buttonPrimary}>Restore this version</SubmitButton>
        </form>
      )}
    </>
  );
}
