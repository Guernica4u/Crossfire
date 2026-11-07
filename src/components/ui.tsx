import type { CSSProperties, ReactNode } from "react";
import type { DebateStatus, Stance } from "@/lib/types";
import { cn, initials, stanceLabel } from "@/lib/utils";

export function Avatar({
  name,
  color,
  size = "md",
  className,
  style,
}: {
  name: string;
  color: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn("avatar", `avatar-${size}`, className)}
      style={{ ...style, "--agent-color": color } as CSSProperties}
      title={name}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function StanceBadge({ stance }: { stance: Stance }) {
  return (
    <span
      className={cn(
        "badge",
        stance === "for" && "badge-positive",
        stance === "against" && "badge-negative",
        stance === "undecided" && "badge-neutral",
      )}
    >
      {stanceLabel(stance)}
    </span>
  );
}

export function StatusBadge({ status }: { status: DebateStatus }) {
  const label =
    status === "active"
      ? "Live"
      : status === "paused"
        ? "Paused"
        : status === "judging"
          ? "Judging"
          : status === "complete"
            ? "Verdict"
            : "Error";
  return (
    <span
      className={cn(
        "badge",
        status === "active" && "badge-accent",
        status === "complete" && "badge-positive",
        status === "error" && "badge-danger",
      )}
    >
      {status === "active" && <span className="live-dot" style={{ width: 5, height: 5 }} />}
      {label}
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size, borderWidth: size < 15 ? 1.5 : 2 }}
      aria-hidden="true"
    />
  );
}

export function ScoreBar({
  value,
  color,
  max = 10,
}: {
  value: number;
  color: string;
  max?: number;
}) {
  return (
    <div className="score-track">
      <div
        className="score-fill"
        style={{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%`, background: color }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  copy,
  action,
}: {
  icon: ReactNode;
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div>
        <div className="empty-icon">{icon}</div>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 26, letterSpacing: "-0.03em" }}>
          {title}
        </div>
        <p
          style={{
            maxWidth: 390,
            margin: "7px auto 0",
            color: "var(--muted)",
            fontSize: 12,
            lineHeight: 1.65,
          }}
        >
          {copy}
        </p>
        {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
      </div>
    </div>
  );
}
