import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PRESETS, DEFAULT_JUDGE_MODEL, JUDGE_PRESET, MODEL_CATALOG, getModel } from "@/lib/agents";
import type {
  AgentPosition,
  BeliefAgent,
  BeliefView,
  Debate,
  DebateAgent,
  DebateStatus,
  DebateSummary,
  DebateView,
  JudgeResult,
  Stance,
  Turn,
} from "@/lib/types";
import { safeJson } from "@/lib/utils";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "crossfire.db");

type Row = Record<string, unknown>;

const globalForDb = globalThis as unknown as { crossfireDb?: DatabaseSync };

function createDatabase(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const database = new DatabaseSync(DB_PATH);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS debates (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      phase TEXT NOT NULL DEFAULT 'opening',
      round INTEGER NOT NULL DEFAULT 0,
      rounds INTEGER NOT NULL DEFAULT 1,
      next_speaker_index INTEGER NOT NULL DEFAULT 0,
      result_json TEXT,
      summary TEXT,
      winner_agent_id TEXT,
      tags_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS debate_agents (
      id TEXT PRIMARY KEY,
      debate_id TEXT NOT NULL,
      preset_key TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      color TEXT NOT NULL,
      persona TEXT NOT NULL,
      stance TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (debate_id) REFERENCES debates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      debate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      agent_id TEXT,
      role TEXT NOT NULL,
      phase TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'complete',
      model TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (debate_id) REFERENCES debates(id) ON DELETE CASCADE,
      UNIQUE (debate_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_debate_agents_debate ON debate_agents(debate_id, position);
    CREATE INDEX IF NOT EXISTS idx_turns_debate ON turns(debate_id, seq);

    CREATE TABLE IF NOT EXISTS pool_keys (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      hint TEXT NOT NULL,
      label TEXT,
      contributor TEXT,
      encrypted_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      error TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      last_checked_at TEXT
    );
  `);
  return database;
}

function getDb(): DatabaseSync {
  if (!globalForDb.crossfireDb) {
    globalForDb.crossfireDb = createDatabase();
  }
  return globalForDb.crossfireDb;
}

function mapDebate(row: Row): Debate {
  return {
    id: String(row.id),
    topic: String(row.topic),
    status: row.status as DebateStatus,
    phase: row.phase as Debate["phase"],
    round: Number(row.round),
    rounds: Number(row.rounds),
    nextSpeakerIndex: Number(row.next_speaker_index),
    resultJson: row.result_json ? String(row.result_json) : null,
    summary: row.summary ? String(row.summary) : null,
    winnerAgentId: row.winner_agent_id ? String(row.winner_agent_id) : null,
    tagsJson: row.tags_json ? String(row.tags_json) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function mapAgent(row: Row): DebateAgent {
  return {
    id: String(row.id),
    debateId: String(row.debate_id),
    presetKey: row.preset_key ? String(row.preset_key) : null,
    name: String(row.name),
    role: row.role as DebateAgent["role"],
    model: String(row.model),
    provider: String(row.provider),
    color: String(row.color),
    persona: String(row.persona),
    stance: row.stance as Stance,
    position: Number(row.position),
  };
}

function mapTurn(row: Row): Turn {
  return {
    id: String(row.id),
    debateId: String(row.debate_id),
    seq: Number(row.seq),
    agentId: row.agent_id ? String(row.agent_id) : null,
    role: row.role as Turn["role"],
    phase: row.phase as Turn["phase"],
    content: String(row.content ?? ""),
    status: row.status as Turn["status"],
    model: row.model ? String(row.model) : null,
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
  };
}

function parseResult(value: string | null | undefined): JudgeResult | null {
  return safeJson<JudgeResult | null>(value ?? null, null);
}

export interface CreateDebateAgentInput {
  presetKey: string;
  model: string;
  stance: Stance;
}

export interface CreateDebateInput {
  topic: string;
  rounds: number;
  agents: CreateDebateAgentInput[];
  judgeModel?: string;
}

export function createDebate(input: CreateDebateInput): DebateView {
  const database = getDb();
  const topic = input.topic.trim();
  if (topic.length < 4) throw new Error("Give the debate a topic with at least 4 characters.");
  if (topic.length > 280) throw new Error("Keep the topic under 280 characters.");
  if (!Array.isArray(input.agents) || input.agents.length !== 3) {
    throw new Error("A debate needs exactly three debaters.");
  }

  const rounds = Math.min(3, Math.max(1, Number(input.rounds) || 1));
  const judgeModel = input.judgeModel && MODEL_CATALOG.some((model) => model.id === input.judgeModel)
    ? input.judgeModel
    : DEFAULT_JUDGE_MODEL;

  const debateId = crypto.randomUUID();
  const now = new Date().toISOString();

  const rows = input.agents.map((agent, index) => {
    const preset = AGENT_PRESETS.find((item) => item.key === agent.presetKey);
    if (!preset) throw new Error(`Unknown debater preset: ${agent.presetKey}`);
    if (!MODEL_CATALOG.some((model) => model.id === agent.model)) {
      throw new Error("Only the free models listed in the app can be used.");
    }
    const model = getModel(agent.model);
    return {
      id: crypto.randomUUID(),
      debateId,
      presetKey: preset.key,
      name: preset.name,
      role: "debater" as const,
      model: agent.model,
      provider: model.family,
      color: preset.color,
      persona: preset.persona,
      stance: agent.stance === "for" || agent.stance === "against" ? agent.stance : "undecided",
      position: index,
    };
  });

  const judge = {
    id: crypto.randomUUID(),
    debateId,
    presetKey: JUDGE_PRESET.key,
    name: JUDGE_PRESET.name,
    role: "judge" as const,
    model: judgeModel,
    provider: getModel(judgeModel).family,
    color: JUDGE_PRESET.color,
    persona: JUDGE_PRESET.persona,
    stance: "undecided" as const,
    position: 3,
  };

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `INSERT INTO debates
          (id, topic, status, phase, round, rounds, next_speaker_index, created_at, updated_at)
         VALUES (?, ?, 'active', 'opening', 0, ?, 0, ?, ?)`,
      )
      .run(debateId, topic, rounds, now, now);

    const insertAgent = database.prepare(
      `INSERT INTO debate_agents
        (id, debate_id, preset_key, name, role, model, provider, color, persona, stance, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const row of [...rows, judge]) {
      insertAgent.run(
        row.id,
        row.debateId,
        row.presetKey,
        row.name,
        row.role,
        row.model,
        row.provider,
        row.color,
        row.persona,
        row.stance,
        row.position,
      );
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const view = getDebateView(debateId);
  if (!view) throw new Error("Could not create the debate.");
  return view;
}

export function getDebateView(id: string): DebateView | null {
  const database = getDb();
  const debateRow = database.prepare("SELECT * FROM debates WHERE id = ?").get(id) as Row | undefined;
  if (!debateRow) return null;
  const debate = mapDebate(debateRow);
  const agents = (database
    .prepare("SELECT * FROM debate_agents WHERE debate_id = ? ORDER BY position ASC")
    .all(id) as Row[]).map(mapAgent);
  const turns = (database
    .prepare("SELECT * FROM turns WHERE debate_id = ? ORDER BY seq ASC")
    .all(id) as Row[]).map(mapTurn);

  return {
    debate,
    agents,
    turns,
    result: parseResult(debate.resultJson),
  };
}

export function getDebate(id: string): Debate | null {
  const database = getDb();
  const row = database.prepare("SELECT * FROM debates WHERE id = ?").get(id) as Row | undefined;
  return row ? mapDebate(row) : null;
}

export function getDebateAgents(debateId: string): DebateAgent[] {
  const database = getDb();
  return (database
    .prepare("SELECT * FROM debate_agents WHERE debate_id = ? ORDER BY position ASC")
    .all(debateId) as Row[]).map(mapAgent);
}

export function getTurns(debateId: string): Turn[] {
  const database = getDb();
  return (database
    .prepare("SELECT * FROM turns WHERE debate_id = ? ORDER BY seq ASC")
    .all(debateId) as Row[]).map(mapTurn);
}

export function getTurn(id: string): Turn | null {
  const database = getDb();
  const row = database.prepare("SELECT * FROM turns WHERE id = ?").get(id) as Row | undefined;
  return row ? mapTurn(row) : null;
}

export function getStreamingTurn(debateId: string): Turn | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM turns WHERE debate_id = ? AND status = 'streaming' ORDER BY seq DESC LIMIT 1")
    .get(debateId) as Row | undefined;
  return row ? mapTurn(row) : null;
}

export function updateDebateStatus(id: string, status: DebateStatus): void {
  const database = getDb();
  database
    .prepare("UPDATE debates SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
}

export function updateDebateState(
  id: string,
  state: Pick<Debate, "phase" | "round" | "nextSpeakerIndex"> & { status?: DebateStatus },
): void {
  const database = getDb();
  database
    .prepare(
      `UPDATE debates
       SET phase = ?, round = ?, next_speaker_index = ?, status = COALESCE(?, status), updated_at = ?
       WHERE id = ?`,
    )
    .run(
      state.phase,
      state.round,
      state.nextSpeakerIndex,
      state.status ?? null,
      new Date().toISOString(),
      id,
    );
}

export function insertTurn(input: {
  id: string;
  debateId: string;
  agentId: string | null;
  role: Turn["role"];
  phase: Turn["phase"];
  content: string;
  status: Turn["status"];
  model?: string | null;
  error?: string | null;
}): Turn {
  const database = getDb();
  const row = database
    .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM turns WHERE debate_id = ?")
    .get(input.debateId) as Row;
  const seq = Number(row.next_seq);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO turns
        (id, debate_id, seq, agent_id, role, phase, content, status, model, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.debateId,
      seq,
      input.agentId,
      input.role,
      input.phase,
      input.content,
      input.status,
      input.model ?? null,
      input.error ?? null,
      now,
    );
  return {
    id: input.id,
    debateId: input.debateId,
    seq,
    agentId: input.agentId,
    role: input.role,
    phase: input.phase,
    content: input.content,
    status: input.status,
    model: input.model ?? null,
    error: input.error ?? null,
    createdAt: now,
  };
}

export function updateTurn(
  id: string,
  input: { content?: string; status?: Turn["status"]; model?: string | null; error?: string | null },
): void {
  const database = getDb();
  database
    .prepare(
      `UPDATE turns
       SET content = COALESCE(?, content),
           status = COALESCE(?, status),
           model = COALESCE(?, model),
           error = COALESCE(?, error)
       WHERE id = ?`,
    )
    .run(
      input.content ?? null,
      input.status ?? null,
      input.model ?? null,
      input.error ?? null,
      id,
    );
}

export function markTurnInterrupted(turnId: string, partial: string): void {
  const database = getDb();
  database
    .prepare("UPDATE turns SET content = ?, status = 'interrupted', error = NULL WHERE id = ? AND status = 'streaming'")
    .run(partial, turnId);
}

export function discardStreamingTurn(turnId: string): void {
  const database = getDb();
  database.prepare("DELETE FROM turns WHERE id = ? AND status = 'streaming'").run(turnId);
}

export function finalizeStreamingTurn(turnId: string, content: string, model: string): boolean {
  const database = getDb();
  const result = database
    .prepare(
      "UPDATE turns SET content = ?, status = 'complete', model = ?, error = NULL WHERE id = ? AND status = 'streaming'",
    )
    .run(content, model, turnId);
  return Number(result.changes) > 0;
}

export function failStreamingTurn(turnId: string, content: string, message: string): boolean {
  const database = getDb();
  const result = database
    .prepare(
      "UPDATE turns SET content = ?, status = 'error', error = ? WHERE id = ? AND status = 'streaming'",
    )
    .run(content, message.slice(0, 1000), turnId);
  return Number(result.changes) > 0;
}

export function setNextSpeaker(id: string, index: number): void {
  const database = getDb();
  database
    .prepare("UPDATE debates SET next_speaker_index = ?, updated_at = ? WHERE id = ?")
    .run(index, new Date().toISOString(), id);
}

export function insertUserInterjection(
  debateId: string,
  content: string,
  turnId: string | null,
  partial: string,
): DebateView {
  const database = getDb();
  const debate = getDebate(debateId);
  if (!debate) throw new Error("Debate not found.");

  const clean = content.trim().slice(0, 2000);
  if (!clean) throw new Error("Write something before cutting in.");

  database.exec("BEGIN IMMEDIATE");
  try {
    if (turnId) {
      const interrupted = getTurn(turnId);
      if (interrupted && interrupted.status === "streaming") {
        if (partial.trim()) {
          markTurnInterrupted(turnId, partial.trim());
        } else {
          discardStreamingTurn(turnId);
        }
        if (interrupted.agentId) {
          const agent = getDebateAgents(debateId).find((item) => item.id === interrupted.agentId);
          if (agent && agent.role === "debater") {
            setNextSpeaker(debateId, agent.position);
          }
        }
      }
    }

    insertTurn({
      id: crypto.randomUUID(),
      debateId,
      agentId: null,
      role: "user",
      phase: "user",
      content: clean,
      status: "complete",
    });

    database
      .prepare("UPDATE debates SET status = 'active', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), debateId);

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const view = getDebateView(debateId);
  if (!view) throw new Error("Could not update the debate.");
  return view;
}

export function saveJudgeResult(debateId: string, result: JudgeResult): void {
  const database = getDb();
  const now = new Date().toISOString();
  const winner = result.winnerAgentId
    ? (getDebateAgents(debateId).find((agent) => agent.id === result.winnerAgentId)?.id ?? null)
    : null;
  database
    .prepare(
      `UPDATE debates
       SET status = 'complete', phase = 'complete', result_json = ?, summary = ?, winner_agent_id = ?,
           tags_json = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(result), result.verdict, winner, JSON.stringify(result.tags ?? []), now, now, debateId);
}

export function listDebates(limit = 30): DebateSummary[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT d.*, a.name AS winner_name, a.color AS winner_color
       FROM debates d
       LEFT JOIN debate_agents a ON a.id = d.winner_agent_id
       ORDER BY datetime(d.created_at) DESC
       LIMIT ?`,
    )
    .all(limit) as Row[];

  return rows.map((row) => {
    const debate = mapDebate(row);
    const debaters = getDebateAgents(debate.id).filter((agent) => agent.role === "debater");
    return {
      id: debate.id,
      topic: debate.topic,
      status: debate.status,
      phase: debate.phase,
      createdAt: debate.createdAt,
      completedAt: debate.completedAt,
      winnerName: row.winner_name ? String(row.winner_name) : null,
      winnerColor: row.winner_color ? String(row.winner_color) : null,
      summary: debate.summary,
      tags: safeJson<string[]>(debate.tagsJson, []),
      debaters: debaters.map((agent) => ({
        id: agent.id,
        name: agent.name,
        color: agent.color,
        stance: agent.stance,
        model: agent.model,
      })),
    };
  });
}

export function getDebateStats(): {
  total: number;
  completed: number;
  live: number;
  debaters: number;
} {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status IN ('active', 'paused', 'judging') THEN 1 ELSE 0 END) AS live
       FROM debates`,
    )
    .get() as Row;
  const agents = database
    .prepare("SELECT COUNT(*) AS count FROM debate_agents WHERE role = 'debater'")
    .get() as Row;
  return {
    total: Number(row.total ?? 0),
    completed: Number(row.completed ?? 0),
    live: Number(row.live ?? 0),
    debaters: Number(agents.count ?? 0),
  };
}

export function getBeliefView(): BeliefView {
  const database = getDb();
  const debates = (database
    .prepare("SELECT * FROM debates WHERE status = 'complete' AND result_json IS NOT NULL ORDER BY datetime(created_at) DESC")
    .all() as Row[]).map(mapDebate);

  const agentMap = new Map<string, BeliefAgent>();
  const stanceTotals: Record<Stance, number> = { for: 0, against: 0, undecided: 0 };
  const tagCounts = new Map<string, number>();
  const recentConsensus: BeliefView["recentConsensus"] = [];
  const unresolved: BeliefView["unresolved"] = [];
  let totalPositions = 0;
  let consensusNumerator = 0;

  for (const debate of debates) {
    const result = parseResult(debate.resultJson);
    if (!result) continue;
    const debaters = getDebateAgents(debate.id).filter((agent) => agent.role === "debater");
    const positions = new Map<string, AgentPosition>(
      (result.positions ?? []).map((position) => [position.agentId, position]),
    );

    const debateStances: Stance[] = [];
    for (const agent of debaters) {
      const position = positions.get(agent.id);
      if (!position) continue;
      const stance = position.stance === "for" || position.stance === "against" ? position.stance : "undecided";
      const confidence = Math.min(100, Math.max(0, Number(position.confidence) || 0));
      debateStances.push(stance);
      stanceTotals[stance] += 1;
      totalPositions += 1;

      const key = agent.presetKey ?? agent.name.toLowerCase();
      const existing = agentMap.get(key) ?? {
        key,
        name: agent.name,
        color: agent.color,
        debates: 0,
        positions: 0,
        stances: { for: 0, against: 0, undecided: 0 },
        averageConfidence: 0,
        recent: [],
      };
      existing.debates += 1;
      existing.positions += 1;
      existing.stances[stance] += 1;
      existing.averageConfidence += confidence;
      if (existing.recent.length < 4) {
        existing.recent.push({
          debateId: debate.id,
          topic: debate.topic,
          stance,
          confidence,
          summary: position.summary || "",
          date: debate.completedAt ?? debate.createdAt,
        });
      }
      agentMap.set(key, existing);
    }

    if (debateStances.length > 1) {
      const counts = { for: 0, against: 0, undecided: 0 };
      for (const stance of debateStances) counts[stance] += 1;
      const majority = Math.max(counts.for, counts.against, counts.undecided);
      consensusNumerator += majority / debateStances.length;
    }

    for (const tag of result.tags ?? []) {
      const clean = tag.trim().toLowerCase();
      if (!clean) continue;
      tagCounts.set(clean, (tagCounts.get(clean) ?? 0) + 1);
    }

    if (result.consensus && recentConsensus.length < 4) {
      recentConsensus.push({
        debateId: debate.id,
        topic: debate.topic,
        consensus: result.consensus,
        date: debate.completedAt ?? debate.createdAt,
      });
    }

    for (const point of result.unresolved ?? []) {
      if (unresolved.length >= 6 || !point) break;
      unresolved.push({ debateId: debate.id, topic: debate.topic, point });
    }
  }

  const agents = [...agentMap.values()]
    .map((agent) => ({
      ...agent,
      averageConfidence: agent.positions ? agent.averageConfidence / agent.positions : 0,
    }))
    .sort((a, b) => b.positions - a.positions);

  return {
    totalDebates: debates.length,
    totalPositions,
    consensusRate: debates.length ? (consensusNumerator / debates.length) * 100 : 0,
    stanceTotals,
    agents,
    tags: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 14),
    recentConsensus,
    unresolved,
  };
}

export interface StoredPoolKey {
  id: string;
  fingerprint: string;
  hint: string;
  label: string | null;
  contributor: string | null;
  encryptedKey: string;
  status: "active" | "invalid" | "disabled";
  error: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastCheckedAt: string | null;
}

export interface PublicPoolKey {
  id: string;
  hint: string;
  label: string | null;
  contributor: string | null;
  status: StoredPoolKey["status"];
  createdAt: string;
  lastUsedAt: string | null;
}

function mapPoolKey(row: Row): StoredPoolKey {
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    hint: String(row.hint),
    label: row.label ? String(row.label) : null,
    contributor: row.contributor ? String(row.contributor) : null,
    encryptedKey: String(row.encrypted_key),
    status: row.status as StoredPoolKey["status"],
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
  };
}

export function listStoredPoolKeys(): StoredPoolKey[] {
  const database = getDb();
  return (database
    .prepare("SELECT * FROM pool_keys ORDER BY datetime(created_at) DESC")
    .all() as Row[]).map(mapPoolKey);
}

export function listPublicPoolKeys(): PublicPoolKey[] {
  return listStoredPoolKeys().map(({ id, hint, label, contributor, status, createdAt, lastUsedAt }) => ({
    id,
    hint,
    label,
    contributor,
    status,
    createdAt,
    lastUsedAt,
  }));
}

export function findPoolKeyByFingerprint(fingerprint: string): StoredPoolKey | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM pool_keys WHERE fingerprint = ?")
    .get(fingerprint) as Row | undefined;
  return row ? mapPoolKey(row) : null;
}

export function insertPoolKey(input: {
  fingerprint: string;
  hint: string;
  label?: string | null;
  contributor?: string | null;
  encryptedKey: string;
}): PublicPoolKey {
  const database = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO pool_keys
        (id, fingerprint, hint, label, contributor, encrypted_key, status, created_at, last_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      id,
      input.fingerprint,
      input.hint,
      input.label ?? null,
      input.contributor ?? null,
      input.encryptedKey,
      now,
      now,
    );
  return { id, hint: input.hint, label: input.label ?? null, contributor: input.contributor ?? null, status: "active", createdAt: now, lastUsedAt: null };
}

export function markPoolKeyUsed(id: string): void {
  const database = getDb();
  database.prepare("UPDATE pool_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function markPoolKeyStatus(
  id: string,
  status: StoredPoolKey["status"],
  error?: string | null,
): void {
  const database = getDb();
  database
    .prepare("UPDATE pool_keys SET status = ?, error = ?, last_checked_at = ? WHERE id = ?")
    .run(status, error ?? null, new Date().toISOString(), id);
}

export function countPoolKeys(): { total: number; active: number } {
  const database = getDb();
  const row = database
    .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM pool_keys")
    .get() as Row;
  return { total: Number(row.total ?? 0), active: Number(row.active ?? 0) };
}
