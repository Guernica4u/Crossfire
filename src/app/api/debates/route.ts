import { createDebate, listDebates } from "@/lib/db";
import { getProviderCapacity } from "@/lib/capacity";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import type { Stance } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  return Response.json({ debates: await listDebates() }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const limit = await enforceRateLimit(request, "debate-create", 6, 3600);
  if (!limit.allowed) return rateLimitResponse(limit);

  try {
    const body = (await request.json()) as {
      topic?: unknown;
      rounds?: unknown;
      agents?: Array<{ presetKey?: unknown; model?: unknown; stance?: Stance }>;
      judgeModel?: unknown;
    };

    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    if (topic.length < 8) {
      return Response.json(
        { error: "Give the debate a question with at least 8 characters." },
        { status: 400 },
      );
    }
    if (topic.length > 200) {
      return Response.json(
        { error: "Keep the question under 200 characters." },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.agents) || body.agents.length !== 3) {
      return Response.json(
        { error: "Topic and exactly three debaters are required." },
        { status: 400 },
      );
    }

    const rounds = Math.min(3, Math.max(1, Number(body.rounds) || 1));
    const capacity = await getProviderCapacity(rounds);
    if (!capacity.capacity.canStart) {
      return Response.json(
        {
          error:
            capacity.capacity.message ??
            "The free pool cannot finish a debate right now. Try again after the daily reset.",
        },
        { status: 503, headers: NO_STORE },
      );
    }

    const view = await createDebate({
      topic,
      rounds,
      agents: body.agents.map((agent) => ({
        presetKey: String(agent.presetKey ?? ""),
        model: String(agent.model ?? ""),
        stance:
          agent.stance === "for" || agent.stance === "against" || agent.stance === "undecided"
            ? agent.stance
            : "undecided",
      })),
      judgeModel: typeof body.judgeModel === "string" ? body.judgeModel : undefined,
    });

    return Response.json(
      { view, warning: capacity.capacity.message },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create the debate." },
      { status: 400, headers: NO_STORE },
    );
  }
}
