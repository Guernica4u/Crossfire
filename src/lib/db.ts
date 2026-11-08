import { getCloudflareContext } from "@opennextjs/cloudflare";
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

type Row = Record<string, unknown>;

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
};

type AppEnv = {
  DB?: D1Database;
};

const globalForDb = globalThis as unknown as {
  crossfireSchemaReady?: Promise<void>;
};

const SCHEMA = `
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
  CREATE INDEX IF NOT EXISTS idx_debates_created ON debates(created_at);

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
`;

function binding(): D1Database {
  const { env } = getCloudflareContext();
  const database = (env as unknown as AppEnv).DB;
  if (!database) {
    throw new Error("The hosted DB binding is not configured.");
  }
  return database;
}

async function getDb(): Promise<D1Database> {
  const database = binding();
  if (!globalForDb.crossfireSchemaReady) {
    const statements = SCHEMA.split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => database.prepare(statement));
    globalForDb.crossfireSchemaReady = database
      .batch(statements)
      .then(() => undefined)
      .catch((error) => {
        globalForDb.crossfireSchemaReady = undefined;
        throw error;
      });
  }
  await globalForDb.crossfireSchemaReady;
  return database;
}

async function all<T>(query: string, values: unknown[] = []): Promise<T[]> {
  const database = await getDb();
  const result = await database.prepare(query).bind(...values).all<T>();
  return result.results ?? [];
}

async function first<T>(query: string, values: unknown[] = []): Promise<T | null> {
  const database = await getDb();
  return (await database.prepare(query).bind(...values).first<T>()) ?? null;
}

async function execute(query: string, values: unknown[] = []): Promise<number> {
  const database = await getDb();
  const result = await database.prepare(query).bind(...values).run();
  return Number(result.meta?.changes ?? 0);
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

export async function createDebate(input: CreateDebateInput): Promise<DebateView> {
  const database = await getDb();
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

  const statements = [
    database
      .prepare(
        `INSERT INTO debates
          (id, topic, status, phase, round, rounds, next_speaker_index, created_at, updated_at)
         VALUES (?, ?, 'active', 'opening', 0, ?, 0, ?, ?)`,
      )
      .bind(debateId, topic, rounds, now, now),
    ...([...rows, judge].map((row) =>
      database
        .prepare(
          `INSERT INTO debate_agents
            (id, debate_id, preset_key, name, role, model, provider, color, persona, stance, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
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
        ),
    )),
  ];

  await database.batch(statements);

  const view = await getDebateView(debateId);
  if (!view) throw new Error("Could not create the debate.");
  return view;
}

export async function getDebateView(id: string): Promise<DebateView | null> {
  const debateRow = await first<Row>("SELECT * FROM debates WHERE id = ?", [id]);
  if (!debateRow) return null;
  const debate = mapDebate(debateRow);
  const [agents, turns] = await Promise.all([
    all<Row>("SELECT * FROM debate_agents WHERE debate_id = ? ORDER BY position ASC", [id]),
    all<Row>("SELECT * FROM turns WHERE debate_id = ? ORDER BY seq ASC", [id]),
  ]);

  return {
    debate,
    agents: agents.map(mapAgent),
    turns: turns.map(mapTurn),
    result: parseResult(debate.resultJson),
  };
}

export async function getDebate(id: string): Promise<Debate | null> {
  const row = await first<Row>("SELECT * FROM debates WHERE id = ?", [id]);
  return row ? mapDebate(row) : null;
}

export async function getDebateAgents(debateId: string): Promise<DebateAgent[]> {
  const rows = await all<Row>(
    "SELECT * FROM debate_agents WHERE debate_id = ? ORDER BY position ASC",
    [debateId],
  );
  return rows.map(mapAgent);
}

export async function getTurns(debateId: string): Promise<Turn[]> {
  const rows = await all<Row>("SELECT * FROM turns WHERE debate_id = ? ORDER BY seq ASC", [debateId]);
  return rows.map(mapTurn);
}

export async function getTurn(id: string): Promise<Turn | null> {
  const row = await first<Row>("SELECT * FROM turns WHERE id = ?", [id]);
  return row ? mapTurn(row) : null;
}

export async function getStreamingTurn(debateId: string): Promise<Turn | null> {
  const row = await first<Row>(
    "SELECT * FROM turns WHERE debate_id = ? AND status = 'streaming' ORDER BY seq DESC LIMIT 1",
    [debateId],
  );
  return row ? mapTurn(row) : null;
}

export async function updateDebateStatus(id: string, status: DebateStatus): Promise<void> {
  await execute("UPDATE debates SET status = ?, updated_at = ? WHERE id = ?", [
    status,
    new Date().toISOString(),
    id,
  ]);
}

export async function updateDebateState(
  id: string,
  state: Pick<Debate, "phase" | "round" | "nextSpeakerIndex"> & { status?: DebateStatus },
): Promise<void> {
  await execute(
    `UPDATE debates
     SET phase = ?, round = ?, next_speaker_index = ?, status = COALESCE(?, status), updated_at = ?
     WHERE id = ?`,
    [
      state.phase,
      state.round,
      state.nextSpeakerIndex,
      state.status ?? null,
      new Date().toISOString(),
      id,
    ],
  );
}

export async function insertTurn(input: {
  id: string;
  debateId: string;
  agentId: string | null;
  role: Turn["role"];
  phase: Turn["phase"];
  content: string;
  status: Turn["status"];
  model?: string | null;
  error?: string | null;
}): Promise<Turn> {
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO turns
      (id, debate_id, seq, agent_id, role, phase, content, status, model, error, created_at)
     SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?
     FROM turns
     WHERE debate_id = ?`,
    [
      input.id,
      input.debateId,
      input.agentId,
      input.role,
      input.phase,
      input.content,
      input.status,
      input.model ?? null,
      input.error ?? null,
      now,
      input.debateId,
    ],
  );
  const inserted = await first<Row>("SELECT seq FROM turns WHERE id = ?", [input.id]);
  if (!inserted) throw new Error("Could not append the turn.");
  return {
    id: input.id,
    debateId: input.debateId,
    seq: Number(inserted.seq),
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

export async function updateTurn(
  id: string,
  input: { content?: string; status?: Turn["status"]; model?: string | null; error?: string | null },
): Promise<void> {
  await execute(
    `UPDATE turns
     SET content = COALESCE(?, content),
         status = COALESCE(?, status),
         model = COALESCE(?, model),
         error = COALESCE(?, error)
     WHERE id = ?`,
    [
      input.content ?? null,
      input.status ?? null,
      input.model ?? null,
      input.error ?? null,
      id,
    ],
  );
}

export async function markTurnInterrupted(turnId: string, partial: string): Promise<void> {
  await execute(
    "UPDATE turns SET content = ?, status = 'interrupted', error = NULL WHERE id = ? AND status = 'streaming'",
    [partial, turnId],
  );
}

export async function discardStreamingTurn(turnId: string): Promise<void> {
  await execute("DELETE FROM turns WHERE id = ? AND status = 'streaming'", [turnId]);
}

export async function finalizeStreamingTurn(turnId: string, content: string, model: string): Promise<boolean> {
  const changes = await execute(
    "UPDATE turns SET content = ?, status = 'complete', model = ?, error = NULL WHERE id = ? AND status = 'streaming'",
    [content, model, turnId],
  );
  return changes > 0;
}

export async function failStreamingTurn(turnId: string, content: string, message: string): Promise<boolean> {
  const changes = await execute(
    "UPDATE turns SET content = ?, status = 'error', error = ? WHERE id = ? AND status = 'streaming'",
    [content, message.slice(0, 1000), turnId],
  );
  return changes > 0;
}

export async function setNextSpeaker(id: string, index: number): Promise<void> {
  await execute("UPDATE debates SET next_speaker_index = ?, updated_at = ? WHERE id = ?", [
    index,
    new Date().toISOString(),
    id,
  ]);
}

export async function insertUserInterjection(
  debateId: string,
  content: string,
  turnId: string | null,
  partial: string,
): Promise<DebateView> {
  const debate = await getDebate(debateId);
  if (!debate) throw new Error("Debate not found.");

  const clean = content.trim().slice(0, 2000);
  if (!clean) throw new Error("Write something before cutting in.");

  if (turnId) {
    const interrupted = await getTurn(turnId);
    if (interrupted && interrupted.status === "streaming") {
      if (partial.trim()) {
        await markTurnInterrupted(turnId, partial.trim());
      } else {
        await discardStreamingTurn(turnId);
      }
      if (interrupted.agentId) {
        const agent = (await getDebateAgents(debateId)).find((item) => item.id === interrupted.agentId);
        if (agent && agent.role === "debater") {
          await setNextSpeaker(debateId, agent.position);
        }
      }
    }
  }

  await insertTurn({
    id: crypto.randomUUID(),
    debateId,
    agentId: null,
    role: "user",
    phase: "user",
    content: clean,
    status: "complete",
  });

  await execute("UPDATE debates SET status = 'active', updated_at = ? WHERE id = ?", [
    new Date().toISOString(),
    debateId,
  ]);

  const view = await getDebateView(debateId);
  if (!view) throw new Error("Could not update the debate.");
  return view;
}

export async function saveJudgeResult(debateId: string, result: JudgeResult): Promise<void> {
  const now = new Date().toISOString();
  const winner = result.winnerAgentId
    ? ((await getDebateAgents(debateId)).find((agent) => agent.id === result.winnerAgentId)?.id ?? null)
    : null;
  await execute(
    `UPDATE debates
     SET status = 'complete', phase = 'complete', result_json = ?, summary = ?, winner_agent_id = ?,
         tags_json = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      JSON.stringify(result),
      result.verdict,
      winner,
      JSON.stringify(result.tags ?? []),
      now,
      now,
      debateId,
    ],
  );
}

export async function listDebates(limit = 30): Promise<DebateSummary[]> {
  const rows = await all<Row>(
    `SELECT d.*, a.name AS winner_name, a.color AS winner_color
     FROM debates d
     LEFT JOIN debate_agents a ON a.id = d.winner_agent_id
     ORDER BY datetime(d.created_at) DESC
     LIMIT ?`,
    [limit],
  );

  const ids = rows.map((row) => String(row.id));
  const agentRows = ids.length
    ? await all<Row>(
        `SELECT * FROM debate_agents
         WHERE debate_id IN (${ids.map(() => "?").join(", ")})
         ORDER BY position ASC`,
        ids,
      )
    : [];
  const agentsByDebate = new Map<string, DebateAgent[]>();
  for (const row of agentRows) {
    const agent = mapAgent(row);
    const list = agentsByDebate.get(agent.debateId) ?? [];
    list.push(agent);
    agentsByDebate.set(agent.debateId, list);
  }

  return rows.map((row) => {
    const debate = mapDebate(row);
    const debaters = (agentsByDebate.get(debate.id) ?? []).filter((agent) => agent.role === "debater");
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

export async function getDebateStats(): Promise<{
  total: number;
  completed: number;
  live: number;
  debaters: number;
}> {
  const row = await first<Row>(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status IN ('active', 'paused', 'judging') THEN 1 ELSE 0 END) AS live
     FROM debates`,
  );
  const agents = await first<Row>("SELECT COUNT(*) AS count FROM debate_agents WHERE role = 'debater'");
  return {
    total: Number(row?.total ?? 0),
    completed: Number(row?.completed ?? 0),
    live: Number(row?.live ?? 0),
    debaters: Number(agents?.count ?? 0),
  };
}

export async function getBeliefView(): Promise<BeliefView> {
  const debates = (
    await all<Row>(
      "SELECT * FROM debates WHERE status = 'complete' AND result_json IS NOT NULL ORDER BY datetime(created_at) DESC",
    )
  ).map(mapDebate);

  const ids = debates.map((debate) => debate.id);
  const agentRows = ids.length
    ? await all<Row>(
        `SELECT * FROM debate_agents
         WHERE debate_id IN (${ids.map(() => "?").join(", ")})
         ORDER BY debate_id ASC, position ASC`,
        ids,
      )
    : [];
  const agentsByDebate = new Map<string, DebateAgent[]>();
  for (const row of agentRows) {
    const agent = mapAgent(row);
    const list = agentsByDebate.get(agent.debateId) ?? [];
    list.push(agent);
    agentsByDebate.set(agent.debateId, list);
  }

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
    const debaters = (agentsByDebate.get(debate.id) ?? []).filter((agent) => agent.role === "debater");
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

export async function listStoredPoolKeys(): Promise<StoredPoolKey[]> {
  const rows = await all<Row>("SELECT * FROM pool_keys ORDER BY datetime(created_at) DESC");
  return rows.map(mapPoolKey);
}

export async function listPublicPoolKeys(): Promise<PublicPoolKey[]> {
  return (await listStoredPoolKeys()).map(({ id, hint, label, contributor, status, createdAt, lastUsedAt }) => ({
    id,
    hint,
    label,
    contributor,
    status,
    createdAt,
    lastUsedAt,
  }));
}

export async function findPoolKeyByFingerprint(fingerprint: string): Promise<StoredPoolKey | null> {
  const row = await first<Row>("SELECT * FROM pool_keys WHERE fingerprint = ?", [fingerprint]);
  return row ? mapPoolKey(row) : null;
}

export async function insertPoolKey(input: {
  fingerprint: string;
  hint: string;
  label?: string | null;
  contributor?: string | null;
  encryptedKey: string;
}): Promise<PublicPoolKey> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO pool_keys
      (id, fingerprint, hint, label, contributor, encrypted_key, status, created_at, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      id,
      input.fingerprint,
      input.hint,
      input.label ?? null,
      input.contributor ?? null,
      input.encryptedKey,
      now,
      now,
    ],
  );
  return {
    id,
    hint: input.hint,
    label: input.label ?? null,
    contributor: input.contributor ?? null,
    status: "active",
    createdAt: now,
    lastUsedAt: null,
  };
}

export async function markPoolKeyUsed(id: string): Promise<void> {
  await execute("UPDATE pool_keys SET last_used_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
}

export async function markPoolKeyStatus(
  id: string,
  status: StoredPoolKey["status"],
  error?: string | null,
): Promise<void> {
  await execute("UPDATE pool_keys SET status = ?, error = ?, last_checked_at = ? WHERE id = ?", [
    status,
    error ?? null,
    new Date().toISOString(),
    id,
  ]);
}

export async function countPoolKeys(): Promise<{ total: number; active: number }> {
  const row = await first<Row>(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM pool_keys",
  );
  return { total: Number(row?.total ?? 0), active: Number(row?.active ?? 0) };
}
