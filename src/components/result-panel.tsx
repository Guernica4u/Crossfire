import { Gavel, Scale, Sparkles, Trophy } from "lucide-react";
import type { DebateAgent, JudgeResult } from "@/lib/types";
import { Avatar, ScoreBar, StanceBadge } from "@/components/ui";
import { SpeakButton } from "@/components/speak-button";
import { getModel } from "@/lib/agents";

export function ResultPanel({
  result,
  agents,
}: {
  result: JudgeResult;
  agents: DebateAgent[];
}) {
  const debaters = agents.filter((agent) => agent.role === "debater");
  const byId = new Map(debaters.map((agent) => [agent.id, agent]));
  const winner = result.winnerAgentId ? byId.get(result.winnerAgentId) : null;
  const judge = agents.find((agent) => agent.role === "judge");

  return (
    <section className="result-wrap fade-in">
      <div className="result-top">
        <div className="result-kicker eyebrow">
          <Gavel size={13} />
          The verdict
        </div>
        <h2 className="result-title">
          {winner ? (
            <>
              {winner.name} takes the room.
            </>
          ) : (
            <>No clear winner.</>
          )}
        </h2>
        <p className="result-verdict">{result.verdict}</p>
        <SpeakButton
          id="verdict"
          text={result.verdict}
          agentId={judge?.id}
          voiceSlot={judge?.position ?? 3}
          label="Hear the verdict"
          mutedLabel="Unmute judge"
          className="button button-sm result-listen"
        />

        <div className="winner-line">
          {winner ? (
            <>
              <Avatar name={winner.name} color={winner.color} size="md" />
              <div>
                <div className="eyebrow">Winner</div>
                <div className="winner-name">{winner.name}</div>
              </div>
              <StanceBadge stance={winner.stance} />
            </>
          ) : (
            <>
              <Scale size={22} style={{ color: "var(--muted)" }} />
              <div>
                <div className="eyebrow">Result</div>
                <div className="winner-name">Draw</div>
              </div>
            </>
          )}
          <div style={{ flex: 1 }} />
          <div className="tag-list">
            {result.tags.map((tag) => (
              <span key={tag} className="badge">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="result-grid">
        <div className="result-box">
          <h3 className="result-box-title">Scorecard</h3>
          <div>
            {debaters.map((agent) => {
              const score = result.scores.find((item) => item.agentId === agent.id);
              return (
                <div
                  key={agent.id}
                  className="score-row"
                  style={{ gridTemplateColumns: "34px minmax(0, 1fr) 58px" }}
                >
                  <Avatar name={agent.name} color={agent.color} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div className="score-name">{agent.name}</div>
                    <div style={{ marginTop: 4 }}>
                      <ScoreBar value={score?.overall ?? 0} color={agent.color} />
                    </div>
                  </div>
                  <div className="score-value">{score ? `${score.overall.toFixed(1)}/10` : "—"}</div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            {debaters.map((agent) => {
              const score = result.scores.find((item) => item.agentId === agent.id);
              if (!score) return null;
              return (
                <div key={agent.id}>
                  <div className="eyebrow" style={{ marginBottom: 5 }}>
                    {agent.name.replace(/^The\s+/i, "")}
                  </div>
                  <div className="score-value" style={{ textAlign: "left", lineHeight: 1.7 }}>
                    Logic {score.logic} · Evidence {score.evidence}
                    <br />
                    Persuasion {score.persuasion} · Clarity {score.clarity}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="result-box">
          <h3 className="result-box-title">Final positions</h3>
          <div className="position-list">
            {result.positions.map((position) => {
              const agent = byId.get(position.agentId);
              if (!agent) return null;
              return (
                <div className="position-item" key={position.agentId}>
                  <Avatar name={agent.name} color={agent.color} size="sm" />
                  <div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span className="position-name">{agent.name}</span>
                      <StanceBadge stance={position.stance} />
                      <span className="badge">{position.confidence}% confidence</span>
                    </div>
                    <div className="position-summary">{position.summary}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="result-box">
          <h3 className="result-box-title">What they agreed on</h3>
          <div style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.65 }}>
            {result.consensus}
          </div>
          {result.strongestArguments.length > 0 ? (
            <>
              <h3 className="result-box-title" style={{ marginTop: 17 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Trophy size={11} />
                  Strongest arguments
                </span>
              </h3>
              <div style={{ display: "grid", gap: 8 }}>
                {result.strongestArguments.map((argument, index) => {
                  const agent = byId.get(argument.agentId);
                  return (
                    <div
                      key={`${argument.agentId}-${index}`}
                      style={{
                        display: "flex",
                        gap: 8,
                        color: "var(--muted)",
                        fontSize: 10,
                        lineHeight: 1.55,
                      }}
                    >
                      <Sparkles
                        size={11}
                        style={{ flex: "0 0 auto", marginTop: 2, color: agent?.color ?? "var(--accent)" }}
                      />
                      <span>
                        <strong style={{ color: "var(--text)", fontWeight: 700 }}>
                          {agent?.name ?? "A debater"}:
                        </strong>{" "}
                        {argument.point}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        <div className="result-box">
          <h3 className="result-box-title">Still unresolved</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {result.unresolved.length > 0 ? (
              result.unresolved.map((point, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    gap: 8,
                    color: "var(--muted)",
                    fontSize: 10,
                    lineHeight: 1.55,
                  }}
                >
                  <span style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 8 }}>
                    0{index + 1}
                  </span>
                  <span>{point}</span>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 10 }}>
                The judge found no major unresolved disagreement.
              </div>
            )}
          </div>
          <div className="caveat" style={{ marginTop: 14 }}>
            This verdict is a structured interpretation of the transcript, not a fact-check.
            Judge model: {getModel(agents.find((agent) => agent.role === "judge")?.model ?? "").label}.
          </div>
        </div>
      </div>
    </section>
  );
}
