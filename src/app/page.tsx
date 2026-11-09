import Link from "next/link";
import { ArrowUpRight, Plus, RotateCcw, Scale, Sparkles, Swords } from "lucide-react";
import { getDebateStats, listDebates } from "@/lib/db";
import { Avatar, EmptyState, StatusBadge } from "@/components/ui";
import { excerpt, formatDate, phaseLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TOPICS = [
  "Is God real?",
  "Is free will an illusion?",
  "Should AI have rights?",
  "Has social media made us worse?",
];

export default async function HomePage() {
  const [debates, stats] = await Promise.all([listDebates(), getDebateStats()]);
  const failed = debates.filter((debate) => debate.status === "error");
  const healthy = debates.filter((debate) => debate.status !== "error");

  return (
    <div className="page">
      <section className="hero fade-in">
        <div className="eyebrow">A live arena for hard questions</div>
        <h1 className="hero-title">
          Put a question <em>on trial.</em>
        </h1>
        <p className="hero-copy">
          Different AI models. One topic. Three committed positions. Watch them argue,
          cut in whenever you want, then see what the judge and the archive actually say.
        </p>
        <div className="hero-actions">
          <Link href="/new" className="button button-primary">
            <Plus size={15} />
            Start a debate
          </Link>
          <Link href="/beliefs" className="button button-ghost">
            <Sparkles size={15} />
            Open belief map
          </Link>
        </div>
        <div className="chip-row" style={{ marginTop: 22 }}>
          {TOPICS.map((topic) => (
            <Link
              key={topic}
              href={`/new?topic=${encodeURIComponent(topic)}`}
              className="chip"
            >
              {topic}
            </Link>
          ))}
        </div>
      </section>

      <section className="stat-grid" aria-label="Debate statistics">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total debates</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.completed === 0 ? "—" : stats.completed}</div>
          <div className="stat-label">
            {stats.completed === 0 ? "First verdict pending" : "Verdicts delivered"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.live}</div>
          <div className="stat-label">Live or paused</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.errors}</div>
          <div className="stat-label">Need a retry</div>
        </div>
      </section>

      {failed.length > 0 ? (
        <>
          <div className="section-head">
            <div>
              <div className="eyebrow">Needs attention</div>
              <h2 className="section-title">Stopped debates</h2>
            </div>
            <span className="badge badge-danger">
              {failed.length} stopped
            </span>
          </div>
          <div className="history-list">
            {failed.map((debate) => (
              <Link
                key={debate.id}
                href={`/debate/${debate.id}`}
                className="history-card"
              >
                <div style={{ minWidth: 0 }}>
                  <div className="history-meta">
                    <StatusBadge status={debate.status} />
                    <span>{formatDate(debate.createdAt)}</span>
                    <span>·</span>
                    <span>{phaseLabel(debate.phase)}</span>
                  </div>
                  <div className="history-topic">{debate.topic}</div>
                  <div
                    style={{
                      maxWidth: 650,
                      color: "var(--muted)",
                      fontSize: 11,
                      lineHeight: 1.55,
                    }}
                  >
                    The room stopped before the next voice could finish. The transcript is
                    kept; retry from the last speaker.
                  </div>
                </div>
                <div className="history-side">
                  <div className="eyebrow">Recovery</div>
                  <div className="history-winner">
                    Retry this debate
                    <RotateCcw size={14} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <div className="section-head">
        <div>
          <div className="eyebrow">The archive</div>
          <h2 className="section-title">Past debates</h2>
        </div>
        <Link href="/new" className="button button-sm">
          <Plus size={13} />
          New debate
        </Link>
      </div>

      {healthy.length === 0 ? (
        <EmptyState
          icon={<Swords size={20} />}
          title={failed.length > 0 ? "No healthy debates yet" : "No debates yet"}
          copy={
            failed.length > 0
              ? "The stopped debates above kept their transcripts. Retry one, or set a fresh table."
              : "Pick a question, put three models in the room, and let them fight it out. Your transcript and verdict will live here."
          }
          action={
            <Link href="/new" className="button button-primary">
              <Plus size={15} />
              Set the first table
            </Link>
          }
        />
      ) : (
        <div className="history-list">
          {healthy.map((debate) => {
            const isComplete = debate.status === "complete";
            return (
              <Link
                key={debate.id}
                href={`/debate/${debate.id}`}
                className="history-card"
              >
                <div style={{ minWidth: 0 }}>
                  <div className="history-meta">
                    <StatusBadge status={debate.status} />
                    <span>{formatDate(debate.createdAt)}</span>
                    <span>·</span>
                    <span>{phaseLabel(debate.phase)}</span>
                  </div>
                  <div className="history-topic">{debate.topic}</div>
                  {debate.summary ? (
                    <div
                      style={{
                        maxWidth: 650,
                        color: "var(--muted)",
                        fontSize: 11,
                        lineHeight: 1.55,
                      }}
                    >
                      {excerpt(debate.summary, 150)}
                    </div>
                  ) : null}
                  <div className="history-meta" style={{ marginTop: 10 }}>
                    <div className="history-agents">
                      {debate.debaters.map((agent) => (
                        <Avatar
                          key={agent.id}
                          name={agent.name}
                          color={agent.color}
                          size="sm"
                        />
                      ))}
                    </div>
                    {debate.debaters.map((agent) => (
                      <span key={agent.id} style={{ letterSpacing: 0 }}>
                        {agent.name.replace(/^The\s+/i, "")}
                        <span style={{ color: "var(--faint)" }}> / {agent.stance}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="history-side">
                  {isComplete ? (
                    <>
                      <div className="eyebrow">Verdict</div>
                      <div className="history-winner">
                        {debate.winnerName ? (
                          <>
                            <Avatar
                              name={debate.winnerName}
                              color={debate.winnerColor ?? "var(--accent)"}
                              size="sm"
                            />
                            {debate.winnerName}
                          </>
                        ) : (
                          <>
                            <Scale size={15} style={{ color: "var(--muted)" }} />
                            Draw
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="eyebrow">In progress</div>
                      <div className="history-winner">
                        Open transcript
                        <ArrowUpRight size={14} />
                      </div>
                    </>
                  )}
                  {debate.tags.length > 0 ? (
                    <div
                      className="tag-list"
                      style={{ justifyContent: "flex-end", marginTop: 11 }}
                    >
                      {debate.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="badge">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="section-head">
        <div>
          <div className="eyebrow">How it works</div>
          <h2 className="section-title">A debate, not a chatbot</h2>
        </div>
      </div>
      <div className="how-grid">
        {[
          {
            n: "01",
            title: "Set the table",
            copy: "Choose a question and assign each model a position: for, against, or genuinely undecided.",
          },
          {
            n: "02",
            title: "Cut in live",
            copy: "The debate runs turn by turn. Interrupt mid-sentence, add a point, and make them answer it.",
          },
          {
            n: "03",
            title: "Read the room",
            copy: "A judge scores the clash. The belief map tracks what each agent actually argued over time.",
          },
        ].map((item) => (
          <div key={item.n} className="stat-card" style={{ padding: "18px" }}>
            <div className="eyebrow" style={{ color: "var(--accent)" }}>
              {item.n}
            </div>
            <div
              style={{
                marginTop: 13,
                fontFamily: "var(--font-serif)",
                fontSize: 23,
                letterSpacing: "-0.03em",
              }}
            >
              {item.title}
            </div>
            <div style={{ marginTop: 7, color: "var(--muted)", fontSize: 11, lineHeight: 1.6 }}>
              {item.copy}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
