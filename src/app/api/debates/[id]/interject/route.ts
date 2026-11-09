import { insertUserInterjection } from "@/lib/db";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const limit = await enforceRateLimit(request, "interject", 120, 3600);
  if (!limit.allowed) return rateLimitResponse(limit);

  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      content?: string;
      turnId?: string | null;
      partial?: string;
    };
    const view = await insertUserInterjection(
      id,
      String(body.content ?? ""),
      body.turnId ? String(body.turnId) : null,
      String(body.partial ?? ""),
    );
    return Response.json({ view });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not add your point." },
      { status: 400 },
    );
  }
}
