import { getDebateView, updateDebateStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const view = getDebateView(id);
  if (!view) return Response.json({ error: "Debate not found." }, { status: 404 });
  return Response.json({ view });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { status?: string };
    if (body.status !== "active" && body.status !== "paused") {
      return Response.json({ error: "Status must be active or paused." }, { status: 400 });
    }
    const view = getDebateView(id);
    if (!view) return Response.json({ error: "Debate not found." }, { status: 404 });
    if (view.debate.status === "complete") {
      return Response.json({ error: "This debate is already complete." }, { status: 400 });
    }
    updateDebateStatus(id, body.status);
    return Response.json({ view: getDebateView(id) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update the debate." },
      { status: 400 },
    );
  }
}
