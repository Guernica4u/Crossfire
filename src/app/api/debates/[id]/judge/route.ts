import { getDebateView, getStreamingTurn, saveJudgeResult, updateDebateState, updateDebateStatus } from "@/lib/db";
import { DEFAULT_JUDGE_MODEL } from "@/lib/agents";
import { buildJudgePrompt, normalizeJudgeResult, parseJudgeJson } from "@/lib/prompt";
import { completeChat, fallbackChain } from "@/lib/openrouter";
import { OpenRouterError } from "@/lib/openrouter";
import {
  getKeyCandidates,
  noteCandidateRejected,
  noteCandidateUsed,
} from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const view = await getDebateView(id);
  if (!view) return Response.json({ error: "Debate not found." }, { status: 404 });
  if (view.debate.status === "complete" && view.result) {
    return Response.json({ view, result: view.result });
  }
  if (await getStreamingTurn(id)) {
    return Response.json({ error: "Wait for the current turn to finish." }, { status: 409 });
  }

  const spokenTurns = view.turns.filter((turn) => turn.role === "agent" && turn.content.trim());
  if (spokenTurns.length < 3) {
    return Response.json({ error: "The debate needs at least one round before judgment." }, { status: 400 });
  }

  const judge = view.agents.find((agent) => agent.role === "judge");
  const prompt = buildJudgePrompt({
    debate: view.debate,
    agents: view.agents,
    turns: view.turns,
  });

  await updateDebateState(id, {
    phase: "judging",
    round: view.debate.round,
    nextSpeakerIndex: 0,
    status: "judging",
  });

  const keyCandidates = await getKeyCandidates();
  if (keyCandidates.length === 0) {
    await updateDebateStatus(id, "paused");
    return Response.json(
      { error: "No API key is available for the judge. Add one in Settings or the public pool." },
      { status: 503 },
    );
  }

  const chain = fallbackChain(judge?.model ?? DEFAULT_JUDGE_MODEL);
  let lastError: unknown = null;

  for (const model of chain) {
    const candidate = keyCandidates[chain.indexOf(model) % keyCandidates.length];
    await noteCandidateUsed(candidate);
    try {
      const raw = await completeChat({
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        maxTokens: 3000,
        temperature: 0.2,
        apiKey: candidate.key,
      });
      const parsed = parseJudgeJson(raw);
      const result = normalizeJudgeResult(parsed, view.agents, raw);
      await saveJudgeResult(id, result);
      const updated = await getDebateView(id);
      return Response.json({ view: updated, result: updated?.result ?? result });
    } catch (error) {
      lastError = error;
      if (error instanceof OpenRouterError && (error.status === 401 || error.status === 403)) {
        await noteCandidateRejected(candidate);
      }
      // A malformed verdict is worth one attempt on another free model.
    }
  }

  await updateDebateStatus(id, "paused");
  const message =
    lastError instanceof Error
      ? lastError.message
      : "The judge could not produce a verdict from the free model pool.";
  return Response.json(
    {
      error: `${message} Wait a moment and retry, or switch the judge model in a new debate.`,
    },
    { status: 502 },
  );
}
