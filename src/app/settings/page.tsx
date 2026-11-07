"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  Database,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { MODEL_CATALOG } from "@/lib/agents";
import { Spinner } from "@/components/ui";

type ProviderStatus = {
  configured: boolean;
  label?: string;
  isFreeTier?: boolean;
  usage?: number;
  freeRequests?: { used: number; limit: number; remaining: number };
  error?: string;
};

export default function SettingsPage() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStatus() {
    setLoading(true);
    try {
      const response = await fetch("/api/provider/status", { cache: "no-store" });
      const payload = (await response.json()) as ProviderStatus;
      setStatus(payload);
    } catch {
      setStatus({ configured: false, error: "Could not reach the provider status endpoint." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  const quota = status?.freeRequests;

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <div className="eyebrow">Settings</div>
          <h1 className="page-title">The engine room.</h1>
          <p className="page-sub">
            One free provider, one local database, no billing path. This page shows what is
            configured and what the free pool has left.
          </p>
        </div>
        <button type="button" className="button" onClick={() => void loadStatus()} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <KeyRound size={15} style={{ color: "var(--accent)" }} />
            <span className="eyebrow">OpenRouter</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 13,
              fontSize: 18,
              fontWeight: 800,
            }}
          >
            {loading ? (
              "Checking connection…"
            ) : status?.configured ? (
              <>
                <CheckCircle2 size={17} style={{ color: "var(--positive)" }} />
                Connected
              </>
            ) : (
              <>
                <XCircle size={17} style={{ color: "var(--danger)" }} />
                Not connected
              </>
            )}
          </div>
          <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 11, lineHeight: 1.6 }}>
            {status?.error ?? "The free model pool is available through one OpenRouter key."}
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="kv">
              <span>Key</span>
              <strong>{status?.label ?? (status?.configured ? "Configured" : "Missing")}</strong>
            </div>
            <div className="kv">
              <span>Mode</span>
              <strong>{status?.isFreeTier ? "Free tier" : "Free model only"}</strong>
            </div>
            <div className="kv">
              <span>Requests remaining today</span>
              <strong>{quota ? `${quota.remaining} / ${quota.limit}` : "—"}</strong>
            </div>
            <div className="kv">
              <span>Requests used today</span>
              <strong>{quota ? quota.used : "—"}</strong>
            </div>
          </div>

          <div className="quota-bar" style={{ marginTop: 12 }}>
            <div
              className="quota-fill"
              style={{
                width: quota ? `${(quota.remaining / Math.max(1, quota.limit)) * 100}%` : "0%",
              }}
            />
          </div>

          <a
            href="https://openrouter.ai/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="button button-sm"
            style={{ marginTop: 16 }}
          >
            Open key settings
            <ArrowUpRight size={12} />
          </a>
        </section>

        <section className="settings-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Database size={15} style={{ color: "var(--accent)" }} />
            <span className="eyebrow">Local storage</span>
          </div>
          <div style={{ marginTop: 13, fontSize: 18, fontWeight: 800 }}>SQLite on this PC</div>
          <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 11, lineHeight: 1.6 }}>
            Debate transcripts, verdicts, positions, and settings live in
            <code
              style={{
                display: "inline-block",
                margin: "0 3px",
                padding: "1px 4px",
                borderRadius: 4,
                background: "var(--panel-2)",
                fontFamily: "var(--mono)",
                fontSize: 9,
              }}
            >
              data/crossfire.db
            </code>
            . Nothing is uploaded to a Crossfire account because there isn’t one.
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="kv">
              <span>Database</span>
              <strong>data/crossfire.db</strong>
            </div>
            <div className="kv">
              <span>Accounts</span>
              <strong>None</strong>
            </div>
            <div className="kv">
              <span>Hosting</span>
              <strong>Localhost</strong>
            </div>
            <div className="kv">
              <span>Paid fallback</span>
              <strong>Disabled</strong>
            </div>
          </div>
          <div className="caveat">
            The key is stored in <code>.env.local</code>, which is gitignored. The app never
            sends it to the browser.
          </div>
        </section>

        <section className="settings-card settings-card-wide">
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={15} style={{ color: "var(--accent)" }} />
                <span className="eyebrow">Available free models</span>
              </div>
              <div style={{ marginTop: 9, fontFamily: "var(--font-serif)", fontSize: 25, letterSpacing: "-0.035em" }}>
                The roster
              </div>
            </div>
            <span className="badge badge-accent">No credits required</span>
          </div>

          <div className="model-list" style={{ marginTop: 16 }}>
            {MODEL_CATALOG.map((model) => (
              <div className="model-item" key={model.id}>
                <div>
                  <div style={{ fontWeight: 750 }}>{model.label}</div>
                  <div style={{ marginTop: 2, color: "var(--faint)", fontSize: 9 }}>
                    {model.note}
                  </div>
                </div>
                <span>{model.family}</span>
              </div>
            ))}
          </div>
          <div className="caveat">
            Free models can be rate-limited upstream and their availability can change. The
            app automatically falls back to another free model before it gives up. It never
            routes to a paid model.
          </div>
        </section>

        <section className="settings-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={15} style={{ color: "var(--accent)" }} />
            <span className="eyebrow">Boundaries</span>
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {[
              "No billing path is configured.",
              "No paid model fallback exists.",
              "Your prompts go only to OpenRouter and its free model providers.",
              "Free tiers may log prompts for model improvement. Do not debate private information.",
            ].map((line) => (
              <div
                key={line}
                style={{
                  display: "grid",
                  gridTemplateColumns: "12px 1fr",
                  gap: 8,
                  color: "var(--muted)",
                  fontSize: 11,
                  lineHeight: 1.55,
                }}
              >
                <span style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 9 }}>
                  ✓
                </span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-card">
          <div className="eyebrow">Next step</div>
          <div
            style={{
              marginTop: 10,
              fontFamily: "var(--font-serif)",
              fontSize: 25,
              letterSpacing: "-0.035em",
              lineHeight: 1.1,
            }}
          >
            Put the room to work.
          </div>
          <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 11, lineHeight: 1.6 }}>
            The free pool resets daily. A quick debate uses about ten calls.
          </div>
          <Link href="/new" className="button button-primary" style={{ marginTop: 16 }}>
            Start a debate
          </Link>
        </section>
      </div>
    </div>
  );
}
