import Link from "next/link";
import { Brain, Plus, Scale, Sparkles } from "lucide-react";
import { getBeliefView } from "@/lib/db";
import { Avatar, EmptyState, StanceBadge } from "@/components/ui";
import { formatShortDate, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function BeliefsPage() {
  const beliefs = getBeliefView();
  const totalStances =
    beliefs.stanceTotals.for + beliefs.stanceTotals.against + beliefs.stanceTotals.undecided;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">The belief map</div>
          <h1 className="page-title">What the room argued.</h1>
          <p className="page-sub">
            Every finished debate leaves a trail of positions. This is the aggregate of what
            each agent actually argued — not a claim about what any model secretly believes.
          </p>
        </div>
        <Link href="/new" className="button button-primary">
          <Plus size={15} />
          Add a debate
        </Link>
      </div>

      {beliefs.totalPositions === 0 ? (
        <EmptyState
          icon={<Brain size={20} />}
          title="The map is empty"
          copy="Finish a debate with a verdict and the agents' final positions will start accumulating here."
          action={
            <Link href="/new" className="button button-primary">
              <Plus size={15} />
              Start a debate
            </Link>
          }
        />
      ) : (
        <>
          <section className="belief-hero">
            <div className="belief-summary">
              <div className="eyebrow">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Sparkles size={11} />
                  Aggregate view
                </span>
              </div>
              <h2
                style={{
                  maxWidth: 710,
                  margin: "11px 0 0",
                  fontFamily: "var(--font-serif)",
                  fontSize: "clamp(32px, 4.4vw, 56px)",
                  fontWeight: 500,
                  letterSpacing: "-0.05em",
                  lineHeight: 0.98,
                }}
              >
                The panel has a shape.
              </h2>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 20,
                }}
              >
                <span className="badge badge-positive">
                  {beliefs.stanceTotals.for} for
                </span>
                <span className="badge badge-negative">
                  {beliefs.stanceTotals.against} against
                </span>
                <span className="badge badge-neutral">
                  {beliefs.stanceTotals.undecided} undecided
                </span>
                {beliefs.tags.slice(0, 5).map((tag) => (
                  <span key={tag.tag} className="badge">
                    {tag.tag} · {tag.count}
                  </span>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  marginTop: 24,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border)",
                  color: "var(--muted)",
                  fontSize: 12,
                  lineHeight: 1.65,
                }}
              >
                <Scale size={16} style={{ flex: "0 0 auto", color: "var(--accent)" }} />
                Across {beliefs.totalDebates} finished debate
                {beliefs.totalDebates === 1 ? "" : "s"}, the panel reached an average
                majority agreement of <strong style={{ color: "var(--text)" }}>{pct(beliefs.consensusRate)}</strong>.
                The remainder is the productive disagreement.
              </div>
              <div className="caveat">
                Labels reflect the position an agent argued in the transcript. They are not
                evidence of a model's internal beliefs, loyalties, or stable personality.
              </div>
            </div>

            <div className="belief-stats">
              <div className="belief-stat">
                <div className="stat-value">{beliefs.totalDebates}</div>
                <div className="stat-label">Debates analyzed</div>
              </div>
              <div className="belief-stat">
                <div className="stat-value">{beliefs.totalPositions}</div>
                <div className="stat-label">Positions recorded</div>
              </div>
              <div className="belief-stat">
                <div className="stat-value">{beliefs.agents.length}</div>
                <div className="stat-label">Recurring agents</div>
              </div>
              <div className="belief-stat">
                <div className="stat-value">{totalStances}</div>
                <div className="stat-label">Stance observations</div>
              </div>
            </div>
          </section>

          <div className="section-head">
            <div>
              <div className="eyebrow">By agent</div>
              <h2 className="section-title">Where each voice lands</h2>
            </div>
          </div>

          <section className="belief-agents">
            {beliefs.agents.map((agent) => {
              const total = Math.max(1, agent.positions);
              const forPct = (agent.stances.for / total) * 100;
              const againstPct = (agent.stances.against / total) * 100;
              const undecidedPct = (agent.stances.undecided / total) * 100;
              return (
                <article className="belief-agent" key={agent.key}>
                  <div className="belief-agent-head">
                    <Avatar name={agent.name} color={agent.color} size="md" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>{agent.name}</div>
                      <div
                        style={{
                          marginTop: 2,
                          color: "var(--faint)",
                          fontFamily: "var(--mono)",
                          fontSize: 8,
                          textTransform: "uppercase",
                        }}
                      >
                        {agent.positions} position{agent.positions === 1 ? "" : "s"} · {agent.debates}{" "}
                        debate{agent.debates === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  <div className="belief-bar">
                    <span style={{ width: `${forPct}%`, background: "var(--positive)" }} />
                    <span style={{ width: `${againstPct}%`, background: "var(--negative)" }} />
                    <span style={{ width: `${undecidedPct}%`, background: "var(--neutral)" }} />
                  </div>
                  <div className="belief-legend">
                    <span>For {Math.round(forPct)}%</span>
                    <span>Against {Math.round(againstPct)}%</span>
                    <span>Undecided {Math.round(undecidedPct)}%</span>
                  </div>

                  <div className="kv" style={{ marginTop: 12 }}>
                    <span>Average confidence</span>
                    <strong>{Math.round(agent.averageConfidence)}%</strong>
                  </div>

                  <div className="belief-recent">
                    {agent.recent.slice(0, 3).map((item) => (
                      <Link
                        key={`${item.debateId}-${item.date}`}
                        href={`/debate/${item.debateId}`}
                        className="belief-recent-item"
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <StanceBadge stance={item.stance} />
                          <span style={{ color: "var(--faint)", fontSize: 8 }}>
                            {formatShortDate(item.date)}
                          </span>
                        </div>
                        <div style={{ marginTop: 5 }}>{item.summary || item.topic}</div>
                      </Link>
                    ))}
                  </div>
                </article>
              );
            })}
          </section>

          <div className="belief-columns">
            <section className="panel-flat" style={{ padding: 20 }}>
              <div className="eyebrow">Recurring consensus</div>
              <div className="belief-list" style={{ marginTop: 11 }}>
                {beliefs.recentConsensus.length > 0 ? (
                  beliefs.recentConsensus.map((item) => (
                    <Link
                      key={`${item.debateId}-${item.date}`}
                      href={`/debate/${item.debateId}`}
                      className="belief-list-item"
                    >
                      <div className="belief-list-topic">
                        {item.topic} · {formatShortDate(item.date)}
                      </div>
                      <div className="belief-list-text">{item.consensus}</div>
                    </Link>
                  ))
                ) : (
                  <div className="belief-list-text">No consensus notes yet.</div>
                )}
              </div>
            </section>

            <section className="panel-flat" style={{ padding: 20 }}>
              <div className="eyebrow">Still unresolved</div>
              <div className="belief-list" style={{ marginTop: 11 }}>
                {beliefs.unresolved.length > 0 ? (
                  beliefs.unresolved.map((item, index) => (
                    <div className="belief-list-item" key={`${item.debateId}-${index}`}>
                      <div className="belief-list-topic">{item.topic}</div>
                      <div className="belief-list-text">{item.point}</div>
                    </div>
                  ))
                ) : (
                  <div className="belief-list-text">No unresolved points recorded.</div>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
