import { createDebate, listDebates } from "@/lib/db";
import type { Stance } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ debates: listDebates() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      topic?: string;
      rounds?: number;
      agents?: Array<{ presetKey?: string; model?: string; stance?: Stance }>;
      judgeModel?: string;
    };

    if (!body.topic || !Array.isArray(body.agents)) {
      return Response.json({ error: "Topic and three debaters are required." }, { status: 400 });
    }

    const view = createDebate({
      topic: body.topic,
      rounds: Number(body.rounds) || 1,
      agents: body.agents.map((agent) => ({
        presetKey: String(agent.presetKey ?? ""),
        model: String(agent.model ?? ""),
        stance:
          agent.stance === "for" || agent.stance === "against" || agent.stance === "undecided"
            ? agent.stance
            : "undecided",
      })),
      judgeModel: body.judgeModel,
    });

    return Response.json({ view }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create the debate." },
      { status: 400 },
    );
  }
}
