import type { Debate, DebatePhase } from "@/lib/types";

export interface NextDebateState {
  phase: DebatePhase;
  round: number;
  nextSpeakerIndex: number;
}

/** Advances the turn order after a completed speech. */
export function nextStateAfterTurn(
  debate: Pick<Debate, "phase" | "round" | "rounds" | "nextSpeakerIndex">,
): NextDebateState {
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

/** Three openings, three closings, one judge, and three rebuttals per round. */
export function requiredCallsForDebate(rounds: number): number {
  return 7 + 3 * Math.max(1, Math.min(3, Math.round(rounds) || 1));
}

export function debatesRemaining(requestsRemaining: number | null, rounds: number): number | null {
  if (requestsRemaining === null || !Number.isFinite(requestsRemaining)) return null;
  return Math.max(0, Math.floor(requestsRemaining / requiredCallsForDebate(rounds)));
}
