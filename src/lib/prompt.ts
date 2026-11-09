import type { Debate, DebateAgent, DebatePhase, Stance, Turn } from "@/lib/types";
import { stanceLabel } from "@/lib/utils";

function agentMap(agents: DebateAgent[]): Map<string, DebateAgent> {
  return new Map(agents.map((agent) => [agent.id, agent]));
}

function transcriptLines(turns: Turn[], agents: Map<string, DebateAgent>): string[] {
  return turns.slice(-18).map((turn) => {
    if (turn.role === "user") {
      return `[Human interjection]\n${turn.content}`;
    }
    const agent = turn.agentId ? agents.get(turn.agentId) : null;
    const name = agent?.name ?? "Unknown speaker";
    const stance = agent?.stance ? stanceLabel(agent.stance).toUpperCase() : "";
    const label = turn.phase === "opening" ? "Opening" : turn.phase === "closing" ? "Closing" : "Rebuttal";
    const status = turn.status === "interrupted" ? " · CUT OFF BY HUMAN" : "";
    return `[${label} · ${name}${stance ? ` · ${stance}` : ""}${status}]\n${turn.content}`;
  });
}

function instructionFor(
  phase: DebatePhase,
  round: number,
  rounds: number,
  lastTurn: Turn | undefined,
  speaker: DebateAgent,
  previousSpeakerTurn: Turn | undefined,
): string {
  const userJustSpoke = lastTurn?.role === "user";
  const wasInterrupted = previousSpeakerTurn?.status === "interrupted";

  if (userJustSpoke) {
    return "The human just cut into the debate with a point. Address their point directly and honestly before returning to your case. Do not ignore it or thank them theatrically.";
  }
  if (wasInterrupted) {
    return "Your previous turn was cut off by the human. Acknowledge the interruption briefly, answer the point they raised, and continue your case. Do not repeat your previous wording.";
  }
  if (phase === "opening") {
    return "This is your opening statement. Define the heart of the question from your position, then make your strongest case. Do not attack the other speakers yet.";
  }
  if (phase === "rebuttal") {
    return `This is rebuttal round ${round} of ${rounds}. Respond directly to the strongest point made by another speaker, then advance your own case. Do not simply restate your opening.`;
  }
  if (phase === "closing") {
    return "This is your closing statement. Do not introduce a major new argument. Name the central clash, concede what you must, and give the judge one clear reason to side with you.";
  }
  return "The debate is moving to judgment. Make your final point concisely.";
}

export function buildDebatePrompt(input: {
  debate: Debate;
  agents: DebateAgent[];
  turns: Turn[];
  speaker: DebateAgent;
  phase: DebatePhase;
  round: number;
}): { system: string; user: string } {
  const { debate, agents, turns, speaker, phase, round } = input;
  const byId = agentMap(agents);
  const lastTurn = turns[turns.length - 1];
  const previousSpeakerTurn = [...turns]
    .reverse()
    .find((turn) => turn.agentId === speaker.id);

  const stance = stanceLabel(speaker.stance);
  const transcript = transcriptLines(turns, byId).join("\n\n");
  const instruction = instructionFor(
    phase,
    round,
    debate.rounds,
    lastTurn,
    speaker,
    previousSpeakerTurn,
  );

  const system = `${speaker.persona}

You are ${speaker.name}, a participant in a live, multi-agent debate. You are not a host or narrator.

TOPIC: "${debate.topic}"
YOUR ASSIGNED POSITION: ${stance.toUpperCase()}

Rules:
- Speak in your own voice, in plain prose.
- Take a clear position. Your assigned position is a starting commitment, not a cage: you may concede a specific point, but do not silently switch sides.
- Engage the strongest version of the opposing case. Do not invent a weaker opponent.
- Be specific and concise: 90–160 words. This is a spoken turn, not an essay.
- No headings, bullet lists, stage directions, or meta-commentary.
- Begin with the first sentence of your argument. Never describe the task, your assignment, the rules, or your plan, and never quote these instructions.
- Never mention being an AI, a language model, a prompt, or having a "system prompt."
- Do not fabricate studies, statistics, quotes, historical events, or citations. If you are unsure, say so.
- Do not repeat your earlier wording or the other speakers' phrasing.
- You may ask one sharp question, but do not end every turn with a generic question.
- Follow the turn instruction exactly.`;

  const user = `--- DEBATE SO FAR ---
${transcript || "(The debate has not begun yet.)"}
--- END DEBATE ---

${instruction}

Write your next spoken turn as ${speaker.name}. Start speaking immediately. Return only the words you would say out loud.`;

  return { system, user };
}

export function buildJudgePrompt(input: {
  debate: Debate;
  agents: DebateAgent[];
  turns: Turn[];
}): { system: string; user: string } {
  const { debate, agents, turns } = input;
  const byId = agentMap(agents);
  const debaters = agents.filter((agent) => agent.role === "debater");
  const judge = agents.find((agent) => agent.role === "judge");
  const transcript = transcriptLines(turns, byId).join("\n\n");
  const roster = debaters
    .map(
      (agent) =>
        `- id: "${agent.id}" | ${agent.name} | assigned position: ${stanceLabel(agent.stance)}`,
    )
    .join("\n");

  const system = `${judge?.persona ?? "You are an impartial debate judge."}

You are judging a debate. Evaluate the arguments as they were actually made, not the reputations of the models or the personas. Reward validity, responsiveness, concrete reasoning, intellectual honesty, and clarity. Penalize evasion, repetition, fabricated evidence, empty rhetoric, and failure to engage.

Return ONLY a valid JSON object. No markdown, no code fences, no preamble.`;

  const user = `TOPIC: "${debate.topic}"

DEBATERS:
${roster}

TRANSCRIPT:
${transcript || "(No transcript.)"}

Return a JSON object with exactly these keys:
{
  "winnerAgentId": string | null,
  "verdict": string,
  "consensus": string,
  "positions": [{ "agentId": string, "stance": "for" | "against" | "undecided", "confidence": number, "summary": string }],
  "scores": [{ "agentId": string, "logic": number, "evidence": number, "persuasion": number, "clarity": number, "overall": number }],
  "strongestArguments": [{ "agentId": string, "point": string }],
  "unresolved": [string],
  "tags": [string]
}

Rules:
- "winnerAgentId" must be one of the debater ids above, or null for a draw.
- "verdict" is 2–3 sentences explaining the decision.
- "consensus" is 1–2 sentences describing what the panel actually converged on, if anything.
- Include one position for each debater, even if they conceded.
- "confidence" is 0–100.
- All scores are 0–10.
- "strongestArguments" must contain 2–3 items, each tied to a debater id.
- "unresolved" contains 1–3 genuinely open disagreements or questions.
- "tags" contains 2–4 short topic tags.
- Be fair to the undecided position. Do not automatically reward the most aggressive speaker.
- Do not mention model names in the verdict.`;

  return { system, user };
}

export function parseJudgeJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The judge did not return a JSON object.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function normalizeJudgeResult(
  value: unknown,
  agents: DebateAgent[],
  fallbackText: string,
): {
  winnerAgentId: string | null;
  verdict: string;
  consensus: string;
  positions: Array<{ agentId: string; stance: Stance; confidence: number; summary: string }>;
  scores: Array<{
    agentId: string;
    logic: number;
    evidence: number;
    persuasion: number;
    clarity: number;
    overall: number;
  }>;
  strongestArguments: Array<{ agentId: string; point: string }>;
  unresolved: string[];
  tags: string[];
} {
  const object = (value ?? {}) as Record<string, unknown>;
  const debaters = agents.filter((agent) => agent.role === "debater");
  const validIds = new Set(debaters.map((agent) => agent.id));
  const toNumber = (input: unknown, fallback = 0) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.min(10, Math.max(0, number)) : fallback;
  };
  const toString = (input: unknown, fallback = "") =>
    typeof input === "string" ? input.trim() : fallback;

  const rawWinner = toString(object.winnerAgentId);
  const winnerAgentId = validIds.has(rawWinner) ? rawWinner : null;

  const positions = debaters.map((agent) => {
    const rawList = Array.isArray(object.positions) ? object.positions : [];
    const raw = rawList.find(
      (item) =>
        item &&
        typeof item === "object" &&
        String((item as Record<string, unknown>).agentId) === agent.id,
    ) as Record<string, unknown> | undefined;
    const stanceValue = raw?.stance;
    const stance: Stance =
      stanceValue === "for" || stanceValue === "against" || stanceValue === "undecided"
        ? stanceValue
        : agent.stance;
    const confidenceValue = Number(raw?.confidence);
    return {
      agentId: agent.id,
      stance,
      confidence: Number.isFinite(confidenceValue)
        ? Math.min(100, Math.max(0, confidenceValue))
        : 50,
      summary: toString(raw?.summary, "No final position summary was provided."),
    };
  });

  const scores = debaters.map((agent) => {
    const rawList = Array.isArray(object.scores) ? object.scores : [];
    const raw = rawList.find(
      (item) =>
        item &&
        typeof item === "object" &&
        String((item as Record<string, unknown>).agentId) === agent.id,
    ) as Record<string, unknown> | undefined;
    return {
      agentId: agent.id,
      logic: toNumber(raw?.logic, 5),
      evidence: toNumber(raw?.evidence, 5),
      persuasion: toNumber(raw?.persuasion, 5),
      clarity: toNumber(raw?.clarity, 5),
      overall: toNumber(raw?.overall, 5),
    };
  });

  const strongestArguments = (Array.isArray(object.strongestArguments)
    ? object.strongestArguments
    : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const agentId = toString(raw.agentId);
      if (!validIds.has(agentId)) return null;
      return { agentId, point: toString(raw.point) };
    })
    .filter((item): item is { agentId: string; point: string } => Boolean(item?.point))
    .slice(0, 3);

  const unresolved = (Array.isArray(object.unresolved) ? object.unresolved : [])
    .map((item) => toString(item))
    .filter(Boolean)
    .slice(0, 4);

  const tags = (Array.isArray(object.tags) ? object.tags : [])
    .map((item) => toString(item).toLowerCase())
    .filter(Boolean)
    .slice(0, 5);

  return {
    winnerAgentId,
    verdict: toString(object.verdict, fallbackText || "The judge did not provide a verdict."),
    consensus: toString(
      object.consensus,
      "The panel did not reach a clear consensus, which may be the honest result.",
    ),
    positions,
    scores,
    strongestArguments,
    unresolved,
    tags,
  };
}
