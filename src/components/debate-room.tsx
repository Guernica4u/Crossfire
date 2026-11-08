"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Gavel,
  KeyRound,
  Pause,
  Play,
  RotateCcw,
  Send,
  Swords,
  UserRound,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { DebateAgent, DebatePhase, DebateView, Turn } from "@/lib/types";
import { getModel } from "@/lib/agents";
import { Avatar, Spinner, StanceBadge, StatusBadge } from "@/components/ui";
import { ResultPanel } from "@/components/result-panel";
import { useSpeech } from "@/lib/speech";
import { cn, excerpt, initials, phaseLabel, stanceLabel } from "@/lib/utils";

type LiveTurn = {
  id: string;
  turn: Turn;
  agentId: string;
  agentName: string;
  color: string;
  model: string;
  phase: DebatePhase;
  round: number;
  content: string;
};

type ProviderStatus = {
  configured: boolean;
  label?: string;
  isFreeTier?: boolean;
  usage?: number;
  freeRequests?: { used: number; limit: number; remaining: number };
  pool?: { total: number; active: number; capacity: number };
  error?: string;
};

function roundLabel(phase: DebatePhase, round: number): string {
  if (phase === "opening") return "Opening";
  if (phase === "rebuttal") return `Rebuttal ${round}`;
  if (phase === "closing") return "Closing";
  if (phase === "judging") return "Judgment";
  return "Verdict";
}

function RoomArc({ view }: { view: DebateView }) {
  const phase = view.debate.phase;
  const items: Array<{ key: string; label: string; active: boolean; done: boolean }> = [
    {
      key: "opening",
      label: "Openings",
      active: phase === "opening",
      done: ["rebuttal", "closing", "judging", "complete"].includes(phase),
    },
  ];

  for (let round = 1; round <= view.debate.rounds; round += 1) {
    items.push({
      key: `rebuttal-${round}`,
      label: view.debate.rounds === 1 ? "Rebuttal" : `Rebuttal ${round}`,
      active: phase === "rebuttal" && view.debate.round === round,
      done:
        ["closing", "judging", "complete"].includes(phase) ||
        (phase === "rebuttal" && view.debate.round > round),
    });
  }

  items.push({
    key: "closing",
    label: "Closings",
    active: phase === "closing",
    done: ["judging", "complete"].includes(phase),
  });
  items.push({
    key: "judging",
    label: "Verdict",
    active: phase === "judging",
    done: phase === "complete",
  });

  return (
    <ol className="room-arc" aria-label="Debate progress">
      {items.map((item, index) => (
        <li
          key={item.key}
          data-active={item.active}
          data-done={item.done}
          aria-current={item.active ? "step" : undefined}
        >
          <span className="arc-dot">{item.done ? "✓" : String(index + 1).padStart(2, "0")}</span>
          <span>{item.label}</span>
        </li>
      ))}
    </ol>
  );
}

function JudgeBench({
  judge,
  awake,
  deliberating,
  thought,
}: {
  judge?: DebateAgent;
  awake: boolean;
  deliberating: boolean;
  thought: string;
}) {
  return (
    <div className="judge-bench" data-awake={awake} data-deliberating={deliberating}>
      <div className="judge-figure">
        <span className="judge-halo" aria-hidden="true" />
        <Avatar name={judge?.name ?? "The Arbiter"} color={judge?.color ?? "var(--accent)"} size="sm" />
        <span className="judge-gavel" aria-hidden="true">
          <Gavel size={11} />
        </span>
      </div>
      <div className="judge-identity">
        <div className="eyebrow">The bench · far end</div>
        <div className="judge-name">{judge?.name ?? "The Arbiter"}</div>
        <div className="judge-state">
          {deliberating ? "Deliberating" : awake ? "Talking to himself" : "Waiting for the room"}
        </div>
      </div>
      {awake ? (
        <div className="judge-mutter" aria-live="polite">
          <span className="mutter-mark">“</span>
          {thought}
        </div>
      ) : (
        <div className="judge-wait">All three voices, then the bench speaks.</div>
      )}
    </div>
  );
}

function TranscriptTurn({
  turn,
  agent,
  speaking,
  onSpeak,
}: {
  turn: Turn;
  agent?: DebateAgent;
  speaking: boolean;
  onSpeak: (turn: Turn, agent?: DebateAgent) => void;
}) {
  if (turn.role === "user") {
    return (
      <article className="room-turn room-turn-user">
        <div className="turn-avatar">
          <Avatar name="You" color="var(--accent)" size="sm" />
        </div>
        <div className="turn-main">
          <div className="turn-line">
            <strong>You</strong>
            <span className="badge badge-accent">Cut in</span>
            <span className="turn-meta">Audience</span>
          </div>
          <p className="turn-copy">{turn.content}</p>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn("room-turn", turn.status === "interrupted" && "room-turn-interrupted")}
    >
      <div className="turn-avatar">
        <Avatar name={agent?.name ?? "Voice"} color={agent?.color ?? "var(--faint)"} size="sm" />
      </div>
      <div className="turn-main">
        <div className="turn-line">
          <strong>{agent?.name ?? "Unknown speaker"}</strong>
          {agent ? <StanceBadge stance={agent.stance} /> : null}
          <span className="turn-meta">
            {turn.phase === "user" ? "Interjection" : phaseLabel(turn.phase)} · {
              getModel(turn.model ?? agent?.model ?? "").label
            }
          </span>
          {turn.status === "interrupted" ? <span className="badge">Cut off</span> : null}
          {turn.status === "error" ? <span className="badge badge-danger">Error</span> : null}
          {turn.content.trim() ? (
            <button
              type="button"
              className="turn-speak"
              data-active={speaking}
              aria-label={speaking ? "Stop reading this turn aloud" : "Read this turn aloud"}
              aria-pressed={speaking}
              title={
                speaking
                  ? "Stop reading aloud"
                  : "Read this turn with your browser's built-in voice"
              }
              onClick={() => onSpeak(turn, agent)}
            >
              {speaking ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
          ) : null}
        </div>
        <p className="turn-copy">{turn.content || "—"}</p>
      </div>
    </article>
  );
}

export function DebateRoom({
  initialView,
  autoStart,
}: {
  initialView: DebateView;
  autoStart: boolean;
}) {
  const [view, setViewState] = useState<DebateView>(initialView);
  const viewRef = useRef(initialView);
  const [liveTurn, setLiveTurn] = useState<LiveTurn | null>(null);
  const liveTurnRef = useRef<LiveTurn | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const pausedRef = useRef(initialView.debate.status === "paused");
  const [paused, setPaused] = useState(initialView.debate.status === "paused");
  const [judging, setJudging] = useState(initialView.debate.status === "judging");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sendingPoint, setSendingPoint] = useState(false);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerChecked, setProviderChecked] = useState(false);
  const [listenLive, setListenLive] = useState(false);
  const { speakingId, speak, stop } = useSpeech();
  const abortRef = useRef<AbortController | null>(null);
  const loopPromiseRef = useRef<Promise<void> | null>(null);
  const partialRef = useRef("");
  const turnIdRef = useRef<string | null>(null);
  const didAutoStart = useRef(false);
  const initialTurnsRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastAutoSpokenRef = useRef<string | null>(
    [...initialView.turns]
      .reverse()
      .find(
        (turn) =>
          turn.role === "agent" && Boolean(turn.content.trim()) && turn.status !== "error",
      )?.id ?? null,
  );

  const debaters = useMemo(
    () => view.agents.filter((agent) => agent.role === "debater"),
    [view.agents],
  );
  const judge = useMemo(
    () => view.agents.find((agent) => agent.role === "judge"),
    [view.agents],
  );
  const isComplete = view.debate.status === "complete" && Boolean(view.result);
  const isPaused = paused || view.debate.status === "paused";
  const currentAgent = liveTurn
    ? debaters.find((agent) => agent.id === liveTurn.agentId)
    : undefined;

  const agentTurns = useMemo(
    () =>
      view.turns.filter(
        (turn) => turn.role === "agent" && Boolean(turn.content.trim()) && turn.status !== "error",
      ),
    [view.turns],
  );

  const turnCountFor = (agentId: string) =>
    agentTurns.filter((turn) => turn.agentId === agentId).length;

  const spokenCountFor = (agentId: string) =>
    agentTurns
      .filter((turn) => turn.agentId === agentId)
      .reduce((total, turn) => total + turn.content.trim().length, 0);

  const allThreeSpoken = useMemo(
    () =>
      debaters.length > 0 &&
      debaters.every((agent) =>
        view.turns.some(
          (turn) =>
            turn.agentId === agent.id &&
            Boolean(turn.content.trim()) &&
            turn.status !== "error",
        ),
      ),
    [debaters, view.turns],
  );

  const judgeAwake =
    allThreeSpoken ||
    ["rebuttal", "closing", "judging", "complete"].includes(view.debate.phase) ||
    isComplete;

  const judgeThought = useMemo(() => {
    if (view.result?.verdict) return excerpt(view.result.verdict, 150);
    if (judging || view.debate.phase === "judging") {
      return "Three accounts. One question. I am looking for the claim that survives the clash.";
    }
    if (view.debate.phase === "closing") {
      return "The room is quieter now. That usually means the claims are sharper.";
    }
    if (view.debate.phase === "rebuttal") {
      return "They keep answering a question slightly different from the one that was asked.";
    }
    if (allThreeSpoken) {
      return "All three have spoken. Now the interesting part begins.";
    }
    return "Let them all say their piece before I weigh in.";
  }, [allThreeSpoken, judging, view.debate.phase, view.result?.verdict]);

  const evaluation = useMemo(() => {
    const totalChars = debaters.reduce((total, agent) => total + spokenCountFor(agent.id), 0);
    const values = debaters.map((agent) => {
      const score = view.result?.scores.find((item) => item.agentId === agent.id);
      return {
        agent,
        value: score ? Math.max(0, score.overall) : spokenCountFor(agent.id),
        label: score ? score.overall.toFixed(1) : "",
        turns: turnCountFor(agent.id),
        share: totalChars ? (spokenCountFor(agent.id) / totalChars) * 100 : 100 / Math.max(1, debaters.length),
      };
    });
    const total = values.reduce((sum, item) => sum + item.value, 0);
    return values.map((item) => ({
      ...item,
      width: total > 0 ? (item.value / total) * 100 : 100 / Math.max(1, values.length),
    }));
  }, [debaters, view.result, view.turns]);

  const quota = provider?.freeRequests;
  const phaseNow = judging ? "Judgment" : roundLabel(view.debate.phase, view.debate.round);
  const canSend = Boolean(composer.trim()) && !sendingPoint && !isComplete && !judging;

  function applyView(next: DebateView) {
    viewRef.current = next;
    setViewState(next);
    setPaused(next.debate.status === "paused" && !runningRef.current);
    pausedRef.current = next.debate.status === "paused" && !runningRef.current;
  }

  async function refreshProvider() {
    try {
      const response = await fetch("/api/provider/status", { cache: "no-store" });
      const payload = (await response.json()) as ProviderStatus;
      setProvider(payload);
    } catch {
      setProvider({ configured: false, error: "Could not check the provider." });
    } finally {
      setProviderChecked(true);
    }
  }

  async function refreshView() {
    try {
      const response = await fetch(`/api/debates/${initialView.debate.id}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (response.ok && payload.view) applyView(payload.view);
    } catch {
      // Keep the last known state.
    }
  }

  useEffect(() => {
    void refreshProvider();
  }, []);

  useEffect(() => {
    if (!listenLive) return;
    const latest = [...view.turns]
      .reverse()
      .find(
        (turn) =>
          turn.role === "agent" && Boolean(turn.content.trim()) && turn.status !== "error",
      );
    if (!latest || latest.id === lastAutoSpokenRef.current) return;
    lastAutoSpokenRef.current = latest.id;
    const agent = view.agents.find((item) => item.id === latest.agentId);
    speak({
      id: latest.id,
      text: latest.content,
      agentId: agent?.id ?? latest.agentId,
    });
  }, [listenLive, speak, view.agents, view.turns]);

  useEffect(() => {
    if (initialTurnsRef.current === null) {
      initialTurnsRef.current = view.turns.length;
      return;
    }
    if (view.turns.length === initialTurnsRef.current && !liveTurn) return;
    const element = bottomRef.current;
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [view.turns.length, liveTurn?.content]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stop();
    };
  }, [stop]);

  useEffect(() => {
    if (!autoStart) return;
    if (
      initialView.debate.status === "complete" ||
      initialView.debate.status === "paused" ||
      initialView.debate.status === "error"
    ) {
      return;
    }

    // React Strict Mode mounts effects twice in development. Starting on the
    // next tick lets its first cleanup pass without aborting the opening turn.
    const timer = window.setTimeout(() => {
      if (didAutoStart.current) return;
      didAutoStart.current = true;
      void startLoop();
    }, 0);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  async function streamTurn(): Promise<{ view: DebateView; needsJudge: boolean } | null> {
    const debateId = initialView.debate.id;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/debates/${debateId}/turn`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      if (!response.ok) {
        let message = "The next turn could not start.";
        try {
          const payload = await response.json();
          message = payload.error ?? message;
        } catch {
          // Ignore malformed error bodies.
        }
        throw new Error(message);
      }
      if (!response.body) throw new Error("The provider returned no stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let final: { view: DebateView; needsJudge: boolean } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");

          let eventName = "message";
          let rawData = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            if (line.startsWith("data:")) rawData += line.slice(5).trim();
          }
          if (!rawData) continue;

          let data: Record<string, unknown>;
          try {
            data = JSON.parse(rawData) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (eventName === "meta") {
            const turn = data.turn as Turn;
            const live: LiveTurn = {
              id: String(data.turnId),
              turn,
              agentId: String(data.agentId),
              agentName: String(data.agentName),
              color: String(data.color),
              model: String(data.model),
              phase: data.phase as DebatePhase,
              round: Number(data.round),
              content: "",
            };
            partialRef.current = "";
            turnIdRef.current = live.id;
            liveTurnRef.current = live;
            setLiveTurn(live);
            setStatusMessage(`${live.agentName} is speaking…`);
          } else if (eventName === "token") {
            const text = String(data.text ?? "");
            if (!text) continue;
            partialRef.current += text;
            setLiveTurn((current) => {
              if (!current) return current;
              const next = { ...current, content: current.content + text };
              liveTurnRef.current = next;
              return next;
            });
          } else if (eventName === "status") {
            setStatusMessage(String(data.message ?? ""));
          } else if (eventName === "done") {
            const nextView = data.view as DebateView;
            const needsJudge = Boolean(data.needsJudge);
            setLiveTurn(null);
            liveTurnRef.current = null;
            partialRef.current = "";
            turnIdRef.current = null;
            applyView(nextView);
            setStatusMessage(null);
            void refreshProvider();
            final = { view: nextView, needsJudge };
          } else if (eventName === "error") {
            throw new Error(String(data.message ?? "The model could not respond."));
          }
        }
      }

      if (!final) {
        throw new Error("The turn ended before a response was saved.");
      }
      return final;
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return null;
      throw caught;
    } finally {
      abortRef.current = null;
      setLiveTurn(null);
      liveTurnRef.current = null;
    }
  }

  async function runJudge() {
    setJudging(true);
    setStatusMessage("The Arbiter is weighing the arguments…");
    try {
      const response = await fetch(`/api/debates/${initialView.debate.id}/judge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The judge could not produce a verdict.");
      applyView(payload.view);
      setStatusMessage(null);
      void refreshProvider();
    } finally {
      setJudging(false);
    }
  }

  async function runLoop() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setPaused(false);
    pausedRef.current = false;
    setError(null);

    try {
      let current = viewRef.current;
      while (!pausedRef.current) {
        if (current.debate.status === "complete" || current.debate.phase === "complete") break;
        if (current.debate.phase === "judging") {
          await runJudge();
          break;
        }
        if (current.debate.status === "paused" || current.debate.status === "error") break;

        const result = await streamTurn();
        if (!result) break;
        current = result.view;
        if (pausedRef.current) break;
        if (result.needsJudge) {
          await runJudge();
          break;
        }
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Something interrupted the debate.";
      setError(message);
      pausedRef.current = true;
      setPaused(true);
      await refreshView();
      void refreshProvider();
    } finally {
      runningRef.current = false;
      setRunning(false);
      setStatusMessage(null);
    }
  }

  function startLoop(): Promise<void> {
    if (loopPromiseRef.current) return loopPromiseRef.current;
    const promise = runLoop().finally(() => {
      loopPromiseRef.current = null;
    });
    loopPromiseRef.current = promise;
    return promise;
  }

  async function pauseDebate() {
    if (isComplete) return;
    pausedRef.current = true;
    setPaused(true);
    try {
      const response = await fetch(`/api/debates/${initialView.debate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      const payload = await response.json();
      if (response.ok && payload.view) applyView(payload.view);
    } catch {
      // The local pause still stops the loop.
    }
  }

  async function resumeDebate() {
    if (isComplete) return;
    setError(null);
    pausedRef.current = false;
    setPaused(false);
    try {
      const response = await fetch(`/api/debates/${initialView.debate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not resume the debate.");
      applyView(payload.view);
      pausedRef.current = false;
      setPaused(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resume the debate.");
      return;
    }
    await startLoop();
  }

  async function sendPoint() {
    const text = composer.trim();
    if (!text || sendingPoint || isComplete || judging) return;

    setSendingPoint(true);
    setError(null);
    const turnId = liveTurnRef.current?.id ?? turnIdRef.current;
    const partial = liveTurnRef.current?.content ?? partialRef.current;

    if (liveTurnRef.current || runningRef.current) {
      pausedRef.current = true;
      abortRef.current?.abort();
      await loopPromiseRef.current?.catch(() => undefined);
    }

    try {
      const response = await fetch(`/api/debates/${initialView.debate.id}/interject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, turnId, partial }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not add your point.");

      applyView(payload.view);
      setComposer("");
      setLiveTurn(null);
      liveTurnRef.current = null;
      partialRef.current = "";
      turnIdRef.current = null;
      pausedRef.current = false;
      setPaused(false);
      setSendingPoint(false);
      await startLoop();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add your point.");
      setSendingPoint(false);
    }
  }

  function toggleLiveListening() {
    if (listenLive) {
      setListenLive(false);
      stop();
      return;
    }
    lastAutoSpokenRef.current = null;
    setListenLive(true);
  }

  function speakTurn(turn: Turn, agent?: DebateAgent) {
    if (speakingId === turn.id) {
      stop();
      return;
    }
    speak({ id: turn.id, text: turn.content, agentId: agent?.id ?? turn.agentId });
  }

  return (
    <div className="room-page">
      <div className="room-top">
        <Link href="/" className="back-link">
          <ArrowLeft size={13} />
          Archive
        </Link>
        <div className="room-actions">
          <StatusBadge status={view.debate.status} />
          <button
            type="button"
            className="button button-sm listen-toggle"
            data-active={listenLive}
            aria-pressed={listenLive}
            title="Read new turns aloud with your browser's built-in speech voices"
            onClick={toggleLiveListening}
          >
            {listenLive ? <Volume2 size={13} /> : <VolumeX size={13} />}
            {listenLive ? "Listening" : "Listen live"}
          </button>
          {!isComplete ? (
            <button
              type="button"
              className="button button-sm"
              onClick={() => (isPaused ? void resumeDebate() : void pauseDebate())}
              disabled={judging}
            >
              {isPaused ? <Play size={13} /> : <Pause size={13} />}
              {isPaused ? "Resume" : "Pause"}
            </button>
          ) : (
            <Link href="/new" className="button button-sm">
              <Swords size={13} />
              New debate
            </Link>
          )}
        </div>
      </div>

      <header className="room-head">
        <div className="eyebrow">
          Debate room <span className="head-sep">/</span> {phaseNow}
        </div>
        <h1>{view.debate.topic}</h1>
        <div className="room-subline">
          <span>{debaters.length} voices</span>
          <span>·</span>
          <span>{agentTurns.length} spoken turns</span>
          <span>·</span>
          <span>{view.debate.rounds} rebuttal{view.debate.rounds === 1 ? "" : "s"}</span>
          {provider?.pool ? (
            <>
              <span>·</span>
              <Link href="/pool" className="subline-link">
                {provider.pool.active} community key{provider.pool.active === 1 ? "" : "s"}
              </Link>
            </>
          ) : null}
          {quota ? (
            <>
              <span>·</span>
              <span>{quota.remaining} free left</span>
            </>
          ) : null}
        </div>
        {statusMessage ? (
          <div className="room-live-line" aria-live="polite">
            <span className="live-dot" />
            {statusMessage}
          </div>
        ) : null}
      </header>

      <RoomArc view={view} />

      {error ? (
        <div className="error-banner">
          <AlertTriangle size={15} style={{ flex: "0 0 auto", marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 750, marginBottom: 2 }}>The room hit a snag.</div>
            <div>{error}</div>
            {!isComplete ? (
              <button
                type="button"
                className="button button-sm"
                style={{ marginTop: 9 }}
                onClick={() => void resumeDebate()}
              >
                <RotateCcw size={12} />
                Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="room-stage" aria-label="The debate room">
        <JudgeBench
          judge={judge}
          awake={judgeAwake}
          deliberating={judging || view.debate.phase === "judging"}
          thought={judgeThought}
        />

        <div className="room-table">
          <div className="table-caption">
            <span className="eyebrow">The table</span>
            <span>{isPaused ? "Paused" : liveTurn ? "Voice active" : isComplete ? "Verdict recorded" : "Floor open"}</span>
          </div>
          <div className="seat-grid">
            {debaters.map((agent) => {
              const active = liveTurn?.agentId === agent.id;
              const turns = turnCountFor(agent.id);
              return (
                <div
                  className="seat"
                  key={agent.id}
                  data-active={active}
                  data-spoken={turns > 0}
                  style={{ "--agent-color": agent.color } as CSSProperties}
                >
                  <div className="seat-disc">
                    <span className="seat-halo" aria-hidden="true" />
                    <span className="seat-initials">{initials(agent.name)}</span>
                    {active ? (
                      <span className="speaking-bars" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : turns > 0 ? (
                      <span className="seat-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </div>
                  <div className="seat-name">{agent.name}</div>
                  <div className="seat-meta">
                    {stanceLabel(agent.stance)} · {turns} turn{turns === 1 ? "" : "s"}
                  </div>
                  <div className="seat-model">{getModel(agent.model).label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="evaluation">
          <div className="evaluation-head">
            <div>
              <div className="eyebrow">Evaluation</div>
              <div className="evaluation-note">
                {view.result
                  ? "The judge's scorecard"
                  : "Live share of the floor · scored at the verdict"}
              </div>
            </div>
            <span className="evaluation-tag">
              {view.result ? "Verdict" : `${agentTurns.length} spoken`}
            </span>
          </div>
          <div className="evaluation-track" aria-hidden="true">
            {evaluation.map((item) => (
              <span
                key={item.agent.id}
                className="evaluation-segment"
                style={{
                  width: `${item.width}%`,
                  background: item.agent.color,
                }}
              />
            ))}
          </div>
          <div className="evaluation-legend">
            {evaluation.map((item) => (
              <div key={item.agent.id} className="evaluation-entry">
                <span className="legend-dot" style={{ background: item.agent.color }} />
                <span className="legend-name">{item.agent.name.replace(/^The\s+/i, "")}</span>
                <strong>{view.result ? `${item.label}/10` : `${Math.round(item.share)}%`}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      {view.result ? <ResultPanel result={view.result} agents={view.agents} /> : null}

      <section className="room-transcript">
        <div className="room-transcript-head">
          <div>
            <div className="eyebrow">Transcript</div>
            <h2>The exchange</h2>
          </div>
          <span className="transcript-count">
            {agentTurns.length} spoken
            {liveTurn ? " · live" : ""}
          </span>
        </div>

        {view.turns.length === 0 && !liveTurn ? (
          <div className="transcript-empty">
            <Swords size={20} />
            <div>The floor is open.</div>
            <div className="transcript-empty-sub">
              {isPaused ? "Resume when you are ready for the first voice." : "The first speaker is taking the floor."}
            </div>
          </div>
        ) : null}

        {view.turns.map((turn) => (
          <TranscriptTurn
            key={turn.id}
            turn={turn}
            speaking={speakingId === turn.id}
            onSpeak={speakTurn}
            agent={
              turn.agentId
                ? view.agents.find((agent) => agent.id === turn.agentId)
                : undefined
            }
          />
        ))}

        {liveTurn ? (
          <article className="room-turn room-turn-live">
            <div className="turn-avatar">
              <Avatar name={liveTurn.agentName} color={liveTurn.color} size="sm" />
            </div>
            <div className="turn-main">
              <div className="turn-line">
                <strong>{liveTurn.agentName}</strong>
                {currentAgent ? <StanceBadge stance={currentAgent.stance} /> : null}
                <span className="turn-meta">
                  {phaseLabel(liveTurn.phase)} · {getModel(liveTurn.model).label}
                </span>
                <span className="badge badge-accent">Speaking</span>
              </div>
              {liveTurn.content ? (
                <p className="turn-copy">
                  {liveTurn.content}
                  <span className="streaming-cursor" />
                </p>
              ) : (
                <div className="typing-row">
                  <span className="typing-dots">
                    <span />
                    <span />
                    <span />
                  </span>
                  Taking the floor
                </div>
              )}
            </div>
          </article>
        ) : null}

        {judging ? (
          <div className="typing-row room-judging-row">
            <span className="typing-dots">
              <span />
              <span />
              <span />
            </span>
            <Gavel size={13} />
            The Arbiter is reading the transcript
          </div>
        ) : null}

        {isComplete ? (
          <div className="room-complete-line">
            <span className="status-dot" />
            Debate complete · verdict recorded
          </div>
        ) : null}

        <div ref={bottomRef} />
      </section>

      {!isComplete ? (
        <div className="composer room-composer">
          <div className="composer-meta">
            <span className="composer-who">
              <UserRound size={10} />
              You · audience
            </span>
            <span>
              {judging
                ? "Judge deliberating"
                : liveTurn
                  ? "Cutting in stops the current reply"
                  : isPaused
                    ? "Paused"
                    : "Add a point at any time"}
            </span>
          </div>
          <div className="composer-inner">
            <textarea
              className="textarea"
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              placeholder={
                judging
                  ? "The judge is deliberating…"
                  : "Cut in with a point, question, or objection…"
              }
              disabled={judging || sendingPoint}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendPoint();
                }
              }}
            />
            <button
              type="button"
              className="button button-primary"
              disabled={!canSend}
              onClick={() => void sendPoint()}
              style={{ minHeight: 42, padding: "0 13px" }}
            >
              {sendingPoint ? <Spinner size={13} /> : <Send size={14} />}
              <span style={{ whiteSpace: "nowrap" }}>
                {liveTurn || running ? "Cut in & send" : "Send point"}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="room-after">
          <div>Want a different question, roster, or judge?</div>
          <Link href="/new" className="button button-sm">
            Start another
            <ArrowRight size={12} />
          </Link>
        </div>
      )}

      <footer className="room-footer">
        <div>
          <span className="eyebrow">The room</span>
          <span>No paid fallback. One shared free pool.</span>
        </div>
        <div className="room-footer-links">
          <Link href="/pool">
            <KeyRound size={12} />
            Community pool
          </Link>
          <span className="room-footer-count">
            <Users size={12} />
            {provider?.pool?.active ?? 0} shared
          </span>
        </div>
      </footer>
    </div>
  );
}
