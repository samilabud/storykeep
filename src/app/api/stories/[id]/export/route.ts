import { getSessionUserId } from "@/auth/guards";
import { canExportStory } from "@/billing/entitlement";
import { fileSlug, parseStory } from "@/export/content-model";
import { renderStoryDocx } from "@/export/docx";
import { renderStoryPdf } from "@/export/pdf";
import { getStoryForUser } from "@/stories/data";
import { listVersions } from "@/stories/versions";

export const maxDuration = 30;

const FORMATS = {
  pdf: { render: renderStoryPdf, type: "application/pdf" },
  docx: {
    render: renderStoryDocx,
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
} as const;

const json = (error: string, status: number) => Response.json({ error }, { status });

/** GET /api/stories/:id/export?format=pdf|docx */
export async function GET(request: Request, ctx: RouteContext<"/api/stories/[id]/export">) {
  // 1. Who is asking?
  const userId = await getSessionUserId();
  if (!userId) return json("Not signed in", 401);

  const format = new URL(request.url).searchParams.get("format");
  if (format !== "pdf" && format !== "docx") {
    return json("format must be pdf or docx", 400);
  }

  // 2. Is it their story? (404, never 403: see M1.)
  const { id } = await ctx.params;
  const story = await getStoryForUser(userId, id);
  if (!story) return json("Not found", 404);

  // 3. Have they paid?
  if (!(await canExportStory(story))) return json("Payment required", 402);

  // 4. Is there anything to export?
  const versions = await listVersions(userId, story.id);
  const current = versions?.find((version) => version.id === story.currentVersionId);
  if (!current) return json("This story has no text yet", 409);

  const document = parseStory({
    title: story.title,
    kind: story.kind,
    content: current.content,
  });
  const file = await FORMATS[format].render(document);

  const name = `${fileSlug(story.title)}.${format}`;
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": FORMATS[format].type,
      // "attachment" makes the browser download the file instead of showing it.
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(file.length),
      // A paid, personal file: no shared cache may keep a copy.
      "Cache-Control": "private, no-store",
    },
  });
}
