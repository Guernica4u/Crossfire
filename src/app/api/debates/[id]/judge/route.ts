import {
  getDebateView,
  getStreamingTurn,
  saveJudgeResult,
  updateDebateState,
  updateDebateStatus,
} from "@/lib/db";
import { DEFAULT_JUDGE_MODEL } from "@/lib/agents";
import { buildJudgePrompt, normalizeJudgeResult, parseJudgeJson } from "@/lib/prompt";
import {
  OpenRouterError,
  completeChat,
  errorKind,
  fallbackChain,
  isTransient,
  retryDelayMs,
  sleep,
} from "@/lib/openrouter";
import {
  getKeyCandidates,
  noteCandidateRejected,
  noteCandidateUsed,
} from "@/lib/pool";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { sanitizeErrorText } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_KEYS_PER_MODEL = 2;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const limit = await enforceRateLimit(request, "judge", 30, 3600);
  if (!limit.allowed) return rateLimitResponse(limit);

  const { id } = await context.params;
  const view = await getDebateView(id);
  if (!view) return Response.json({ error: "Debate not found." }, { status: 404 });
  if (view.debate.status === "complete" && view.result) {
    return Response.json({ view, result: view.result }, { headers: NO_STORE });
  }
  if (await getStreamingTurn(id)) {
    return Response.json(
      { error: "Wait for the current turn to finish." },
      { status: 409, headers: NO_STORE },
    );
  }

  const spokenTurns = view.turns.filter((turn) => turn.role === "agent" && turn.content.trim());
  if (spokenTurns.length < 3) {
    return Response.json(
      { error: "The debate needs at least one round before judgment." },
      { status: 400, headers: NO_STORE },
    );
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
      {
        error: "No API key is available for the judge. Add one in Settings or the public pool.",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const debaterModels = view.agents
    .filter((agent) => agent.role === "debater")
    .map((agent) => agent.model);
  const chain = fallbackChain(judge?.model ?? DEFAULT_JUDGE_MODEL, { avoid: debaterModels });
  let lastError: unknown = null;
  let keyAttempt = 0;

  for (let modelIndex = 0; modelIndex < chain.length; modelIndex += 1) {
    const model = chain[modelIndex];
    const keyTries = Math.min(MAX_KEYS_PER_MODEL, keyCandidates.length);

    for (let keyTry = 0; keyTry < keyTries; keyTry += 1) {
      const candidate = keyCandidates[keyAttempt % keyCandidates.length];
      keyAttempt += 1;
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
        return Response.json(
          { view: updated, result: updated?.result ?? result },
          { headers: NO_STORE },
        );
      } catch (error) {
        lastError = error;
        const kind = errorKind(error);
        if (kind === "auth") await noteCandidateRejected(candidate);

        if (isTransient(error) && keyTry < keyTries - 1) {
          const delay = error instanceof OpenRouterError ? error.retryAfterMs : null;
          await sleep(retryDelayMs(keyTry, delay));
          continue;
        }
        // A malformed verdict or an unavailable model is worth one attempt on
        // another free model.
        break;
      }
    }

    if (lastError && isTransient(lastError) && modelIndex < chain.length - 1) {
      const delay = lastError instanceof OpenRouterError ? lastError.retryAfterMs : null;
      await sleep(retryDelayMs(modelIndex, delay));
    }
  }

  await updateDebateStatus(id, "paused");
  const message = sanitizeErrorText(
    lastError instanceof Error
      ? lastError.message
      : "The judge could not produce a verdict from the free model pool.",
  );
  return Response.json(
    {
      error: `${message} Wait a moment and retry, or switch the judge model in a new debate.`,
    },
    { status: 502, headers: NO_STORE },
  );
}
