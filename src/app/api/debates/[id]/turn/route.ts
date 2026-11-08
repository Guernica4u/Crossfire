import {
  discardStreamingTurn,
  finalizeStreamingTurn,
  failStreamingTurn,
  getDebateView,
  getStreamingTurn,
  getTurn,
  insertTurn,
  markTurnInterrupted,
  setNextSpeaker,
  updateDebateState,
  updateDebateStatus,
} from "@/lib/db";
import { getModel } from "@/lib/agents";
import { buildDebatePrompt } from "@/lib/prompt";
import { OpenRouterError, fallbackChain, isRetryable, streamChat } from "@/lib/openrouter";
import {
  getKeyCandidates,
  noteCandidateRejected,
  noteCandidateUsed,
} from "@/lib/pool";
import type { Debate, DebatePhase, DebateView } from "@/lib/types";
import { looksLikeMetaReasoning } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const encoder = new TextEncoder();
const GUARD_CHARS = 140;

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function nextStateAfterTurn(debate: Debate): {
  phase: DebatePhase;
  round: number;
  nextSpeakerIndex: number;
} {
  const index = Math.min(2, Math.max(0, debate.nextSpeakerIndex));

  if (debate.phase === "opening") {
    if (index < 2) return { phase: "opening", round: 0, nextSpeakerIndex: index + 1 };
    return { phase: "rebuttal", round: 1, nextSpeakerIndex: 0 };
  }

  if (debate.phase === "rebuttal") {
    if (index < 2) {
      return { phase: "rebuttal", round: debate.round, nextSpeakerIndex: index + 1 };
    }
    if (debate.round < debate.rounds) {
      return { phase: "rebuttal", round: debate.round + 1, nextSpeakerIndex: 0 };
    }
    return { phase: "closing", round: debate.round, nextSpeakerIndex: 0 };
  }

  if (debate.phase === "closing") {
    if (index < 2) return { phase: "closing", round: debate.round, nextSpeakerIndex: index + 1 };
    return { phase: "judging", round: debate.round, nextSpeakerIndex: 0 };
  }

  return { phase: "judging", round: debate.round, nextSpeakerIndex: 0 };
}

function immediateDone(view: DebateView, needsJudge: boolean): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sse("done", { view, needsJudge }));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const view = await getDebateView(id);
  if (!view) return Response.json({ error: "Debate not found." }, { status: 404 });

  if (view.debate.phase === "complete" || view.debate.status === "complete") {
    return immediateDone(view, false);
  }
  if (view.debate.phase === "judging") {
    return immediateDone(view, true);
  }
  if (view.debate.status === "paused" || view.debate.status === "error") {
    return Response.json(
      { error: "The debate is paused. Resume it before asking for another turn." },
      { status: 409 },
    );
  }

  const stale = await getStreamingTurn(id);
  if (stale) {
    const age = Date.now() - new Date(stale.createdAt).getTime();
    if (age < 120_000) {
      return Response.json({ error: "A turn is already in progress." }, { status: 409 });
    }
    const interruptedAgent = view.agents.find((agent) => agent.id === stale.agentId);
    if (stale.content.trim()) {
      await markTurnInterrupted(stale.id, stale.content);
    } else {
      await discardStreamingTurn(stale.id);
    }
    if (interruptedAgent?.role === "debater") await setNextSpeaker(id, interruptedAgent.position);
    await updateDebateStatus(id, "active");
  }

  const debaters = view.agents.filter((agent) => agent.role === "debater");
  const speaker = debaters[Math.min(debaters.length - 1, Math.max(0, view.debate.nextSpeakerIndex))];
  if (!speaker) return Response.json({ error: "This debate has no debaters." }, { status: 500 });

  const keyCandidates = await getKeyCandidates();
  if (keyCandidates.length === 0) {
    return Response.json(
      { error: "No API key is available. Add one in Settings or contribute a free key to the public pool." },
      { status: 503 },
    );
  }

  const turnId = crypto.randomUUID();
  const turn = await insertTurn({
    id: turnId,
    debateId: id,
    agentId: speaker.id,
    role: "agent",
    phase: view.debate.phase,
    content: "",
    status: "streaming",
    model: speaker.model,
  });

  const nextState = nextStateAfterTurn(view.debate);
  const chain = fallbackChain(speaker.model);
  const messages = buildDebatePrompt({
    debate: view.debate,
    agents: view.agents,
    turns: view.turns,
    speaker,
    phase: view.debate.phase,
    round: view.debate.round,
  });

  let upstream: AbortController | null = null;
  let aborted = false;
  let partial = "";
  let turnFinished = false;

  const persistAbort = async () => {
    if (turnFinished) return;
    const current = await getTurn(turnId);
    if (current?.status !== "streaming") return;
    if (partial.trim()) {
      await markTurnInterrupted(turnId, partial.trim());
    } else {
      await discardStreamingTurn(turnId);
    }
    await setNextSpeaker(id, speaker.position);
    await updateDebateStatus(id, "paused");
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(sse(event, data));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Stream already closed.
        }
      };
      const onRequestAbort = () => {
        aborted = true;
        upstream?.abort();
        void persistAbort();
      };
      request.signal.addEventListener("abort", onRequestAbort, { once: true });

      try {
        send("meta", {
          turnId,
          turn,
          agentId: speaker.id,
          agentName: speaker.name,
          color: speaker.color,
          model: speaker.model,
          phase: view.debate.phase,
          round: view.debate.round,
        });

        let usedModel = speaker.model;
        let content = "";
        let lastError: unknown = null;
        let guardBuffer = "";
        let guardPassed = false;
        let keyAttempt = 0;

        for (const model of chain) {
          if (aborted) {
            const abortError = new Error("The turn was interrupted.");
            abortError.name = "AbortError";
            throw abortError;
          }

          content = "";
          guardBuffer = "";
          guardPassed = false;

          const upstreamController = new AbortController();
          upstream = upstreamController;
          const onUpstreamAbort = () => upstreamController.abort();
          request.signal.addEventListener("abort", onUpstreamAbort, { once: true });
          const candidate = keyCandidates[keyAttempt % keyCandidates.length];
          const attempt = keyAttempt;
          keyAttempt += 1;
          await noteCandidateUsed(candidate);

          try {
            if (model !== speaker.model) {
              send("status", {
                message: `${getModel(speaker.model).label} is unavailable — switching to ${getModel(model).label}.`,
              });
            }
            if (attempt === 1 && candidate.source === "community") {
              send("status", { message: "The owner pool is unavailable — trying a community key." });
            }

            for await (const token of streamChat({
              model,
              messages: [
                { role: "system", content: messages.system },
                { role: "user", content: messages.user },
              ],
              maxTokens: 1600,
              temperature: 0.8,
              signal: upstreamController.signal,
              apiKey: candidate.key,
            })) {
              content += token;
              partial = content;

              if (!guardPassed) {
                guardBuffer += token;
                if (guardBuffer.length < GUARD_CHARS) continue;
                if (looksLikeMetaReasoning(guardBuffer)) {
                  content = "";
                  partial = "";
                  throw new OpenRouterError(
                    "The model wrote its private reasoning instead of a speech.",
                    502,
                  );
                }
                guardPassed = true;
                send("token", { text: guardBuffer });
                guardBuffer = "";
                continue;
              }

              send("token", { text: token });
            }

            if (!guardPassed && guardBuffer) {
              if (looksLikeMetaReasoning(guardBuffer)) {
                content = "";
                partial = "";
                throw new OpenRouterError(
                  "The model wrote its private reasoning instead of a speech.",
                  502,
                );
              }
              send("token", { text: guardBuffer });
              guardBuffer = "";
            }

            if (!content.trim()) {
              throw new OpenRouterError("The model returned no spoken text.", 502);
            }
            usedModel = model;
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            const name = error instanceof Error ? error.name : "";
            if (aborted || name === "AbortError") throw error;
            if (error instanceof OpenRouterError && (error.status === 401 || error.status === 403)) {
              await noteCandidateRejected(candidate);
            }
            // If a model already produced text, retrying would duplicate it.
            if (content.trim().length > 0) throw error;
            if (isRetryable(error) && model !== chain[chain.length - 1]) continue;
            throw error;
          } finally {
            request.signal.removeEventListener("abort", onUpstreamAbort);
            if (upstream === upstreamController) upstream = null;
          }
        }

        if (!content.trim()) {
          throw lastError instanceof Error ? lastError : new Error("No model produced a response.");
        }

        const finalized = await finalizeStreamingTurn(turnId, content.trim(), usedModel);
        if (!finalized) {
          turnFinished = true;
          close();
          return;
        }

        turnFinished = true;
        await updateDebateState(id, nextState);
        const updated = await getDebateView(id);
        send("done", {
          view: updated,
          needsJudge: nextState.phase === "judging",
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (aborted || name === "AbortError") {
          await persistAbort();
        } else {
          const current = await getTurn(turnId);
          if (current?.status === "interrupted") {
            turnFinished = true;
          } else {
            const message =
              error instanceof Error ? error.message : "The model could not respond.";
            if (partial.trim()) {
              await failStreamingTurn(turnId, partial.trim(), message);
            } else {
              await discardStreamingTurn(turnId);
            }
            await updateDebateStatus(id, "error");
            turnFinished = true;
            send("error", {
              message,
              retryable: isRetryable(error),
            });
          }
        }
      } finally {
        request.signal.removeEventListener("abort", onRequestAbort);
        close();
      }
    },
    cancel() {
      aborted = true;
      upstream?.abort();
      void persistAbort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
