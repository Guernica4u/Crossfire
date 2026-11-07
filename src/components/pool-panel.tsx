"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Spinner } from "@/components/ui";

type PoolKey = {
  id: string;
  hint: string;
  label: string | null;
  contributor: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

type Pool = {
  total: number;
  active: number;
  capacity: number;
  keys: PoolKey[];
};

type ContributionResponse = {
  contributed?: boolean;
  key?: PoolKey;
  pool?: Pool;
  error?: string;
  message?: string;
};

export function PoolPanel({ initialPool }: { initialPool: Pool }) {
  const [pool, setPool] = useState(initialPool);
  const [key, setKey] = useState("");
  const [contributor, setContributor] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/pool", { cache: "no-store" });
      const payload = (await response.json()) as { pool?: Pool; error?: string };
      if (!response.ok || !payload.pool) throw new Error(payload.error ?? "Could not read the pool.");
      setPool(payload.pool);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read the pool.");
    } finally {
      setRefreshing(false);
    }
  }

  async function contribute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, contributor }),
      });
      const payload = (await response.json()) as ContributionResponse;
      if (!response.ok || !payload.pool) throw new Error(payload.error ?? "Could not add the key.");
      setPool(payload.pool);
      setKey("");
      setContributor("");
      setMessage(payload.message ?? "Key added to the public pool.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pool-page">
      <header className="pool-head">
        <div className="eyebrow">Community pool</div>
        <h1>Keep the room open.</h1>
        <p>
          A shared pool of free-tier OpenRouter keys. Contributed keys give the arena more
          room when the owner key is rate-limited. Every key is checked before it enters,
          encrypted before it is stored, and only ever used on free models.
        </p>
        <div className="pool-stats">
          <div>
            <strong>{pool.active}</strong>
            <span>active keys</span>
          </div>
          <div>
            <strong>{pool.capacity}</strong>
            <span>pool capacity</span>
          </div>
          <div>
            <strong>{pool.total - pool.active}</strong>
            <span>retired keys</span>
          </div>
        </div>
      </header>

      <div className="pool-layout">
        <section className="pool-card pool-form-card">
          <div className="pool-card-head">
            <div className="pool-icon">
              <KeyRound size={16} />
            </div>
            <div>
              <div className="eyebrow">Contribute</div>
              <h2>Add a free key</h2>
            </div>
          </div>

          <div className="pool-security">
            <ShieldCheck size={15} />
            <div>
              <strong>Server-side only.</strong> The key is verified, encrypted, and never
              shown back to anyone. Revoke it at OpenRouter to remove access.
            </div>
          </div>

          <form onSubmit={contribute} className="pool-form">
            <label className="field">
              <span className="field-label">OpenRouter free-tier key</span>
              <input
                className="input"
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="sk-or-v1-…"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span className="field-label">Name on the key (optional)</span>
              <input
                className="input"
                type="text"
                value={contributor}
                onChange={(event) => setContributor(event.target.value)}
                placeholder="Anonymous"
                maxLength={32}
                autoComplete="off"
                disabled={busy}
              />
            </label>
            <button className="button button-primary" type="submit" disabled={!key.trim() || busy}>
              {busy ? <Spinner /> : <KeyRound size={14} />}
              {busy ? "Checking key…" : "Contribute key"}
            </button>
          </form>

          <div className="pool-links">
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
              Make a free key
              <ArrowUpRight size={12} />
            </a>
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
              Revoke a key
              <ArrowUpRight size={12} />
            </a>
          </div>

          {message ? (
            <div className="pool-result pool-result-ok">
              <CheckCircle2 size={14} />
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="pool-result pool-result-error">
              <AlertTriangle size={14} />
              {error}
            </div>
          ) : null}
        </section>

        <section className="pool-card">
          <div className="pool-card-head">
            <div className="pool-icon">
              <Users size={16} />
            </div>
            <div>
              <div className="eyebrow">The shelf</div>
              <h2>Shared keys</h2>
            </div>
            <button
              className="icon-button pool-refresh"
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              title="Refresh pool"
              aria-label="Refresh pool"
            >
              <RefreshCw size={13} />
            </button>
          </div>

          {pool.keys.length === 0 ? (
            <div className="pool-empty">
              <KeyRound size={18} />
              <div>No community keys yet.</div>
              <p>The owner key still runs the room. Add the first free key above.</p>
            </div>
          ) : (
            <div className="pool-list">
              {pool.keys.map((item) => (
                <div className="pool-key" key={item.id}>
                  <span className="pool-key-dot" />
                  <div>
                    <div className="pool-key-hint">{item.hint}</div>
                    <div className="pool-key-meta">
                      {item.contributor ?? "Anonymous"} · added {formatDate(item.createdAt)}
                      {item.lastUsedAt ? ` · last used ${formatDate(item.lastUsedAt)}` : ""}
                    </div>
                  </div>
                  <span className="badge badge-positive">Active</span>
                </div>
              ))}
            </div>
          )}

          <div className="pool-caveat">
            <strong>Owners can revoke a key at any time.</strong> The pool never reveals the
            full key, and a failed key is removed from selection automatically.
          </div>
        </section>
      </div>

      <section className="pool-note">
        <div className="eyebrow">How it behaves</div>
        <div className="pool-note-grid">
          <div>
            <strong>Owner first.</strong>
            <span>The local key is always tried before community keys.</span>
          </div>
          <div>
            <strong>Free models only.</strong>
            <span>Paid keys are rejected at contribution; no paid fallback is configured.</span>
          </div>
          <div>
            <strong>Not a Pages feature.</strong>
            <span>
              GitHub Pages is static. The pool needs the Node app running on a server.
            </span>
          </div>
        </div>
      </section>

      <div className="pool-back">
        <Link href="/" className="back-link">
          Back to the archive
        </Link>
      </div>
    </div>
  );
}
