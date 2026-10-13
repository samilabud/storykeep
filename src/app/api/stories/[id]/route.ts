import { getSessionUserId } from "@/auth/guards";
import { getStoryForUser } from "@/stories/data";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/stories/[id]">,
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const story = await getStoryForUser(userId, id);
  if (!story) {
    // 404, not 403: do not reveal that the id belongs to someone else.
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({
    id: story.id,
    title: story.title,
    kind: story.kind,
    createdAt: story.createdAt,
  });
}
