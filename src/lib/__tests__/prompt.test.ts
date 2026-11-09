import { describe, expect, it } from "vitest";
import { buildJudgePrompt, normalizeJudgeResult, parseJudgeJson } from "@/lib/prompt";
import type { Debate, DebateAgent } from "@/lib/types";

const debate: Debate = {
  id: "debate-1",
  topic: "Is free will an illusion?",
  status: "active",
  phase: "closing",
  round: 1,
  rounds: 1,
  nextSpeakerIndex: 0,
  resultJson: null,
  summary: null,
  winnerAgentId: null,
  tagsJson: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
};

function agent(
  id: string,
  name: string,
  role: "debater" | "judge",
  stance: DebateAgent["stance"],
  position: number,
): DebateAgent {
  return {
    id,
    debateId: debate.id,
    presetKey: id,
    name,
    role,
    model: "google/gemma-4-31b-it:free",
    provider: "Google",
    color: "#fff",
    persona: "Persona",
    stance,
    position,
  };
}

const agents = [
  agent("a1", "The Logician", "debater", "for", 0),
  agent("a2", "The Skeptic", "debater", "against", 1),
  agent("a3", "The Humanist", "debater", "undecided", 2),
  agent("j1", "The Arbiter", "judge", "undecided", 3),
];

describe("judge prompt", () => {
  it("does not leak model names into the roster", () => {
    const prompt = buildJudgePrompt({ debate, agents, turns: [] });
    expect(prompt.user).toContain("The Logician");
    expect(prompt.user).not.toContain("google/gemma");
    expect(prompt.user).not.toContain("model:");
  });
});

describe("judge parsing", () => {
  it("accepts a fenced JSON object", () => {
    expect(parseJudgeJson('```json\n{"verdict":"ok"}\n```')).toEqual({ verdict: "ok" });
  });

  it("normalizes missing or hostile values", () => {
    const result = normalizeJudgeResult(
      {
        winnerAgentId: "not-a-real-agent",
        verdict: "  A close decision.  ",
        positions: [{ agentId: "a1", stance: "against", confidence: 400 }],
        scores: [{ agentId: "a1", logic: 99, evidence: -4, persuasion: "x", clarity: 3, overall: 8 }],
        strongestArguments: [{ agentId: "a2", point: "A real point" }],
        unresolved: ["One open question"],
        tags: ["Free Will", ""],
      },
      agents,
      "fallback",
    );

    expect(result.winnerAgentId).toBeNull();
    expect(result.verdict).toBe("A close decision.");
    expect(result.positions).toHaveLength(3);
    expect(result.positions[0]).toMatchObject({ agentId: "a1", stance: "against", confidence: 100 });
    expect(result.positions[1]).toMatchObject({ stance: "against" });
    expect(result.scores[0]).toMatchObject({
      logic: 10,
      evidence: 0,
      persuasion: 5,
      clarity: 3,
      overall: 8,
    });
    expect(result.strongestArguments).toEqual([{ agentId: "a2", point: "A real point" }]);
    expect(result.tags).toEqual(["free will"]);
  });
});
