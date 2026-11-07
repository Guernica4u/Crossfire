export type Stance = "for" | "against" | "undecided";
export type AgentRole = "debater" | "judge";
export type DebatePhase = "opening" | "rebuttal" | "closing" | "judging" | "complete";
export type DebateStatus = "active" | "paused" | "judging" | "complete" | "error";
export type TurnStatus = "streaming" | "complete" | "interrupted" | "error";

export interface ModelOption {
  id: string;
  label: string;
  family: string;
  note: string;
}

export interface AgentPreset {
  key: string;
  name: string;
  tagline: string;
  color: string;
  persona: string;
  defaultStance: Stance;
  defaultModel: string;
}

export interface DebateAgent {
  id: string;
  debateId: string;
  presetKey: string | null;
  name: string;
  role: AgentRole;
  model: string;
  provider: string;
  color: string;
  persona: string;
  stance: Stance;
  position: number;
}

export interface Turn {
  id: string;
  debateId: string;
  seq: number;
  agentId: string | null;
  role: "agent" | "user" | "system";
  phase: DebatePhase | "user";
  content: string;
  status: TurnStatus;
  model: string | null;
  error: string | null;
  createdAt: string;
}

export interface Debate {
  id: string;
  topic: string;
  status: DebateStatus;
  phase: DebatePhase;
  round: number;
  rounds: number;
  nextSpeakerIndex: number;
  resultJson: string | null;
  summary: string | null;
  winnerAgentId: string | null;
  tagsJson: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AgentPosition {
  agentId: string;
  stance: Stance;
  confidence: number;
  summary: string;
}

export interface AgentScore {
  agentId: string;
  logic: number;
  evidence: number;
  persuasion: number;
  clarity: number;
  overall: number;
}

export interface StrongestArgument {
  agentId: string;
  point: string;
}

export interface JudgeResult {
  winnerAgentId: string | null;
  verdict: string;
  consensus: string;
  positions: AgentPosition[];
  scores: AgentScore[];
  strongestArguments: StrongestArgument[];
  unresolved: string[];
  tags: string[];
}

export interface DebateView {
  debate: Debate;
  agents: DebateAgent[];
  turns: Turn[];
  result: JudgeResult | null;
}

export interface DebateSummary {
  id: string;
  topic: string;
  status: DebateStatus;
  phase: DebatePhase;
  createdAt: string;
  completedAt: string | null;
  winnerName: string | null;
  winnerColor: string | null;
  summary: string | null;
  tags: string[];
  debaters: Array<Pick<DebateAgent, "id" | "name" | "color" | "stance" | "model">>;
}

export interface BeliefAgent {
  key: string;
  name: string;
  color: string;
  debates: number;
  positions: number;
  stances: Record<Stance, number>;
  averageConfidence: number;
  recent: Array<{
    debateId: string;
    topic: string;
    stance: Stance;
    confidence: number;
    summary: string;
    date: string;
  }>;
}

export interface BeliefView {
  totalDebates: number;
  totalPositions: number;
  consensusRate: number;
  stanceTotals: Record<Stance, number>;
  agents: BeliefAgent[];
  tags: Array<{ tag: string; count: number }>;
  recentConsensus: Array<{
    debateId: string;
    topic: string;
    consensus: string;
    date: string;
  }>;
  unresolved: Array<{ debateId: string; topic: string; point: string }>;
}
