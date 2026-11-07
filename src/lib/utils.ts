import type { DebatePhase, Stance } from "@/lib/types";

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function initials(name: string): string {
  return name
    .replace(/^The\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function stanceLabel(stance: Stance): string {
  if (stance === "for") return "For";
  if (stance === "against") return "Against";
  return "Undecided";
}

export function stanceTone(stance: Stance): string {
  if (stance === "for") return "positive";
  if (stance === "against") return "negative";
  return "neutral";
}

export function phaseLabel(phase: DebatePhase): string {
  if (phase === "opening") return "Opening statements";
  if (phase === "rebuttal") return "Rebuttal";
  if (phase === "closing") return "Closing statements";
  if (phase === "judging") return "Judgment";
  return "Verdict";
}

export function phaseNumber(phase: DebatePhase): string {
  if (phase === "opening") return "01";
  if (phase === "rebuttal") return "02";
  if (phase === "closing") return "03";
  if (phase === "judging") return "04";
  return "05";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function excerpt(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}…`;
}

export function pct(value: number): string {
  return `${Math.round(value)}%`;
}

const META_REASONING_PATTERNS: RegExp[] = [
  /\bthe user (?:wants|is asking|asked|has asked|expects) (?:me|us) to\b/i,
  /\b(?:let me|i(?:'ll| will))(?: carefully)? (?:trace|think|analy[sz]e|work through|reconsider|look at what)\b/i,
  /^(?:the|my) (?:assignment|prompt|instructions|persona) (?:is|was|asks|requires)\b/i,
  /^\*\*(?:opening|rebuttal|closing|analysis|plan|draft|final)\b/i,
  /\b(?:the|my) (?:system|hidden) prompt\b/i,
  /\bno headings,? (?:bullet|lists?)\b/i,
  /\b\d{2,3}\s*[-–—]\s*\d{2,3} words\b/i,
  /\bi(?:'m| am) (?:playing|supposed to|assigned)\b/i,
  /\bi need to (?:close|open|rebut) as\b/i,
  /\b(?:around|about) \d{2,3} words\b/i,
];

/** Detects a model narrating its private reasoning instead of speaking. */
export function looksLikeMetaReasoning(text: string): boolean {
  const sample = text.trim();
  if (!sample) return false;
  return META_REASONING_PATTERNS.some((pattern) => pattern.test(sample));
}
