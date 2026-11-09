"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Gavel,
  Info,
  Loader2,
  Plus,
  Sparkles,
  Swords,
  Users,
} from "lucide-react";
import { AGENT_PRESETS, DEFAULT_JUDGE_MODEL, MODEL_CATALOG, getModel } from "@/lib/agents";
import type { Stance } from "@/lib/types";
import { Avatar, Spinner, StanceBadge } from "@/components/ui";
import { cn, stanceLabel } from "@/lib/utils";

type AgentDraft = {
  presetKey: string;
  name: string;
  tagline: string;
  color: string;
  model: string;
  stance: Stance;
};

const STANCES: Stance[] = ["for", "against", "undecided"];

const EXAMPLES = [
  "Is God real?",
  "Is free will an illusion?",
  "Should AI have rights?",
  "Is taxation theft?",
  "Has social media made us worse?",
];

type ProviderStatus = {
  configured: boolean;
  freeRequests?: { used: number; limit: number; remaining: number };
  pool?: { total: number; active: number; capacity: number };
  capacity?: {
    requestsRemaining: number | null;
    requestsPerDebate: number;
    debatesRemaining: number | null;
    poolActive: number;
    canStart: boolean;
    message?: string;
  };
  error?: string;
};

export function DebateSetup({ initialTopic = "" }: { initialTopic?: string }) {
  const router = useRouter();
  const [topic, setTopic] = useState(initialTopic);
  const [rounds, setRounds] = useState(1);
  const [judgeModel, setJudgeModel] = useState(DEFAULT_JUDGE_MODEL);
  const [agents, setAgents] = useState<AgentDraft[]>(
    AGENT_PRESETS.map((preset) => ({
      presetKey: preset.key,
      name: preset.name,
      tagline: preset.tagline,
      color: preset.color,
      model: preset.defaultModel,
      stance: preset.defaultStance,
    })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);

  const estimatedCalls = 7 + rounds * 3;
  const estimatedDebatesLeft =
    provider?.capacity?.requestsRemaining === null ||
    provider?.capacity?.requestsRemaining === undefined
      ? null
      : Math.floor(provider.capacity.requestsRemaining / estimatedCalls);
  const capacityBlocked = provider?.capacity?.canStart === false;
  const canStart =
    topic.trim().length >= 8 && !submitting && !capacityBlocked;

  useEffect(() => {
    let cancelled = false;
    async function loadCapacity() {
      try {
        const response = await fetch("/api/provider/status", { cache: "no-store" });
        const payload = (await response.json()) as ProviderStatus;
        if (!cancelled) setProvider(payload);
      } catch {
        if (!cancelled) setProvider(null);
      } finally {
        if (!cancelled) setProviderLoading(false);
      }
    }
    void loadCapacity();
    return () => {
      cancelled = true;
    };
  }, []);

  const judge = useMemo(() => getModel(judgeModel), [judgeModel]);

  function updateAgent(index: number, patch: Partial<AgentDraft>) {
    setAgents((current) =>
      current.map((agent, agentIndex) => (agentIndex === index ? { ...agent, ...patch } : agent)),
    );
  }

  async function startDebate() {
    if (!canStart) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/debates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          rounds,
          judgeModel,
          agents: agents.map((agent) => ({
            presetKey: agent.presetKey,
            model: agent.model,
            stance: agent.stance,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not start the debate.");
      router.push(`/debate/${payload.view.debate.id}?fresh=1`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the debate.");
      setSubmitting(false);
    }
  }

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <div className="eyebrow">New debate</div>
          <h1 className="page-title">Set the table.</h1>
          <p className="page-sub">
            One question. Three positions. A judge with no stake in the outcome. Pick the
            roster, then let them go at it.
          </p>
        </div>
        <div className="badge badge-accent">
          <span className="status-dot" style={{ background: "var(--accent)" }} />
          Free models only
        </div>
      </div>

      <div className="setup-grid">
        <div className="setup-main">
          <section className="setup-section">
            <div className="eyebrow">01 · The question</div>
            <div style={{ marginTop: 10 }}>
              <input
                className="input topic-input"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="What should they argue about?"
                maxLength={200}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void startDebate();
                  }
                }}
              />
            </div>
            <div className="chip-row" style={{ marginTop: 12 }}>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className={cn("chip", topic === example && "chip-active")}
                  data-active={topic === example}
                  onClick={() => setTopic(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          </section>

          <section className="setup-section">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div className="eyebrow">02 · The room</div>
                <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 11 }}>
                  Three different model families. Change a model or a position.
                </div>
              </div>
              <span className="badge">
                <Users size={11} />
                3 seats
              </span>
            </div>

            <div style={{ marginTop: 16 }}>
              {agents.map((agent, index) => (
                <div className="agent-config" key={agent.presetKey}>
                  <Avatar name={agent.name} color={agent.color} size="md" />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      <span className="agent-config-name">{agent.name}</span>
                      <StanceBadge stance={agent.stance} />
                    </div>
                    <div className="agent-config-tagline">{agent.tagline}</div>
                    <div className="agent-config-controls">
                      <select
                        className="select"
                        value={agent.model}
                        onChange={(event) => updateAgent(index, { model: event.target.value })}
                        aria-label={`Model for ${agent.name}`}
                      >
                        {MODEL_CATALOG.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label} · {model.family}
                          </option>
                        ))}
                      </select>
                      <div className="stance-picker" role="group" aria-label="Position">
                        {STANCES.map((stance) => (
                          <button
                            key={stance}
                            type="button"
                            className="stance-option"
                            data-active={agent.stance === stance}
                            onClick={() => updateAgent(index, { stance })}
                          >
                            {stanceLabel(stance)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      color: "var(--faint)",
                      fontFamily: "var(--mono)",
                      fontSize: 9,
                      paddingTop: 3,
                      textAlign: "right",
                    }}
                  >
                    0{index + 1}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 7,
                marginTop: 4,
                color: "var(--faint)",
                fontSize: 10,
                lineHeight: 1.5,
              }}
            >
              <Info size={13} style={{ flex: "0 0 auto", marginTop: 1 }} />
              If a model is rate-limited, Crossfire automatically falls back to another free
              model instead of stopping the debate.
            </div>
          </section>

          <section className="setup-section">
            <div className="eyebrow">03 · The format</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginTop: 11,
              }}
            >
              {[
                { value: 1, title: "Quick", copy: "One rebuttal round · 10 calls" },
                { value: 2, title: "Standard", copy: "Two rebuttal rounds · 13 calls" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn("panel-inset", "button")}
                  style={{
                    display: "block",
                    minHeight: 0,
                    padding: "14px",
                    textAlign: "left",
                    borderColor:
                      rounds === option.value
                        ? "color-mix(in srgb, var(--accent) 45%, var(--border))"
                        : undefined,
                    background:
                      rounds === option.value ? "var(--accent-soft)" : "var(--bg-soft)",
                  }}
                  onClick={() => setRounds(option.value)}
                >
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{option.title}</div>
                  <div
                    style={{
                      marginTop: 4,
                      color: "var(--muted)",
                      fontFamily: "var(--mono)",
                      fontSize: 8,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    {option.copy}
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="setup-side">
          <div className="setup-summary">
            <div className="eyebrow">The card</div>
            <div
              style={{
                marginTop: 10,
                fontFamily: "var(--font-serif)",
                fontSize: 25,
                letterSpacing: "-0.035em",
                lineHeight: 1.08,
              }}
            >
              {topic.trim() || "Your question goes here"}
            </div>

            <div style={{ marginTop: 17 }}>
              {agents.map((agent) => (
                <div className="summary-row" key={agent.presetKey}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Avatar name={agent.name} color={agent.color} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 750 }}>{agent.name}</div>
                      <div
                        style={{
                          marginTop: 1,
                          color: "var(--faint)",
                          fontFamily: "var(--mono)",
                          fontSize: 8,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 148,
                        }}
                      >
                        {getModel(agent.model).label}
                      </div>
                    </div>
                  </div>
                  <StanceBadge stance={agent.stance} />
                </div>
              ))}
            </div>

            <div style={{ marginTop: 15, paddingTop: 13, borderTop: "1px solid var(--border)" }}>
              <div className="summary-row" style={{ paddingTop: 0 }}>
                <span className="summary-label">Judge</span>
                <span style={{ fontSize: 10, fontWeight: 700 }}>{judge.label}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Format</span>
                <span style={{ fontSize: 10, fontWeight: 700 }}>
                  {rounds === 1 ? "Quick" : "Standard"} · {rounds} rebuttal
                  {rounds > 1 ? " rounds" : ""}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Est. calls</span>
                <span style={{ fontSize: 10, fontWeight: 700 }}>{estimatedCalls}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Debates left</span>
                <span style={{ fontSize: 10, fontWeight: 700 }}>
                  {providerLoading
                    ? "Checking…"
                    : estimatedDebatesLeft === null
                      ? "Unknown"
                      : estimatedDebatesLeft}
                </span>
              </div>
            </div>

            {provider?.capacity?.message ? (
              <div
                className={capacityBlocked ? "error-banner" : "caveat"}
                role={capacityBlocked ? "alert" : undefined}
                style={{ marginTop: 10 }}
              >
                {provider.capacity.message}
              </div>
            ) : null}

            <div style={{ marginTop: 15 }}>
              <label className="field-label" htmlFor="judge-model">
                Judge model
              </label>
              <select
                id="judge-model"
                className="select"
                style={{ marginTop: 7 }}
                value={judgeModel}
                onChange={(event) => setJudgeModel(event.target.value)}
              >
                {MODEL_CATALOG.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} · {model.family}
                  </option>
                ))}
              </select>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}

            <button
              type="button"
              className="button button-primary"
              style={{ width: "100%", marginTop: 15, minHeight: 44 }}
              disabled={!canStart}
              onClick={() => void startDebate()}
            >
              {submitting ? <Spinner /> : <Swords size={16} />}
              {submitting ? "Setting the table…" : "Begin debate"}
              {!submitting ? <ArrowRight size={15} style={{ marginLeft: "auto" }} /> : null}
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                marginTop: 9,
                color: "var(--faint)",
                fontFamily: "var(--mono)",
                fontSize: 8,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              <Sparkles size={10} />
              Uses the shared daily free pool
            </div>
          </div>

          <div className="panel-inset" style={{ padding: 14, color: "var(--muted)", fontSize: 10, lineHeight: 1.6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text)", fontWeight: 750, fontSize: 11 }}>
              <Gavel size={13} />
              What the judge sees
            </div>
            <div style={{ marginTop: 6 }}>
              Only the transcript. Not model names, not provider logos. It scores logic,
              evidence, persuasion, and clarity.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
