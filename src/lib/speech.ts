"use client";

import { useEffect, useSyncExternalStore } from "react";

type SpeakInput = {
  id: string;
  text: string;
  agentId?: string | null;
  voiceSlot?: number;
  pitch?: number;
  rate?: number;
};

type SpeechState = {
  activeId: string | null;
  activeAgentId: string | null;
  autoRead: boolean;
  mutedIds: string[];
  notice: string | null;
};

type SpeechJob = {
  id: string;
  agentId: string | null;
  voiceSlot: number;
  chunks: string[];
  index: number;
  rate: number;
  pitch: number;
};

const STORAGE_KEY = "crossfire:speech:v1";

const DEFAULT_STATE: SpeechState = {
  activeId: null,
  activeAgentId: null,
  autoRead: false,
  mutedIds: [],
  notice: null,
};

// Natural/neural voices are dramatically better than the default SAPI/eSpeak
// voices. The modifiers keep the same speaker on the same voice and leave
// enough cadence differences for a room full of people.
const VOICE_PROFILES = [
  { rate: 0.98, pitch: 1 },
  { rate: 1.01, pitch: 1.01 },
  { rate: 0.96, pitch: 0.99 },
  { rate: 0.92, pitch: 0.92 },
];

const GOOD_VOICE_NAMES =
  /(natural|neural|enhanced|premium|siri|google|samantha|ava|allison|aria|jenny|emma|libby|sonia|maisie|susan|hazel|serena|karen|moira|tessa|fiona|veena|guy|andrew|brian|christopher|eric|ryan|thomas|daniel|alex|david|mark|george|oliver|james|matthew|liam|noah|william)/i;
const NOVELTY_VOICES =
  /(compact|espeak|eloquence|novelty|whisper|zarvox|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|wobble|bahh|albert|bad news|good news|fred|ralph|kathy|deranged|hysterical|pipe organ)/i;

let state: SpeechState = DEFAULT_STATE;
const listeners = new Set<() => void>();
let currentJob: SpeechJob | null = null;
let queuedJobs: SpeechJob[] = [];
let session = 0;
let hydrated = false;
let autoReadPreferenceSet = false;
let voiceSignature = "";
const assignedVoices = new Map<number, SpeechSynthesisVoice>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function update(patch: Partial<SpeechState>): void {
  const next = { ...state, ...patch };
  if (
    next.activeId === state.activeId &&
    next.activeAgentId === state.activeAgentId &&
    next.autoRead === state.autoRead &&
    next.mutedIds === state.mutedIds &&
    next.notice === state.notice
  ) {
    return;
  }
  state = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { autoRead?: unknown; mutedIds?: unknown };
    const mutedIds = Array.isArray(parsed.mutedIds)
      ? Array.from(
          new Set(
            parsed.mutedIds.filter(
              (value): value is string => typeof value === "string" && value.length > 0,
            ),
          ),
        ).slice(0, 32)
      : [];
    const autoRead = typeof parsed.autoRead === "boolean" ? parsed.autoRead : false;
    autoReadPreferenceSet = typeof parsed.autoRead === "boolean";
    update({ autoRead, mutedIds });
  } catch {
    // Storage can be unavailable in private or embedded contexts.
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ autoRead: state.autoRead, mutedIds: state.mutedIds }),
    );
  } catch {
    // Speech still works when storage is unavailable.
  }
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}

function isMutedId(agentId: string | null | undefined): boolean {
  return Boolean(agentId && state.mutedIds.includes(agentId));
}

function speechText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, "a link")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\[(\d+)\]/g, "")
    .replace(/&/g, " and ")
    .replace(/%/g, " percent ")
    .replace(/\be\.g\.,?/gi, "for example,")
    .replace(/\bi\.e\.,?/gi, "that is,")
    .replace(/\betc\./gi, "et cetera")
    .replace(/\bvs\.?/gi, "versus")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLongSentence(sentence: string, maxLength: number): string[] {
  const pieces: string[] = [];
  let rest = sentence.trim();

  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf(", ", maxLength);
    if (cut < maxLength * 0.45) cut = rest.lastIndexOf(" ", maxLength);
    if (cut < 1) cut = maxLength;
    pieces.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }

  if (rest) pieces.push(rest);
  return pieces;
}

function chunkSpeech(value: string, maxLength = 250): string[] {
  const sentences = value.split(/(?<=[.!?])\s+/).filter(Boolean);
  const merged: string[] = [];

  for (const sentence of sentences) {
    const previous = merged[merged.length - 1];
    if (previous && previous.length < 24) {
      merged[merged.length - 1] = `${previous} ${sentence}`;
    } else {
      merged.push(sentence);
    }
  }

  const chunks: string[] = [];
  let current = "";

  for (const sentence of merged) {
    for (const piece of splitLongSentence(sentence, maxLength)) {
      if (current && current.length + 1 + piece.length > maxLength) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [value];
}

function voiceScore(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  if (lang.startsWith("en-us")) score += 12;
  else if (lang.startsWith("en-gb")) score += 10;
  else if (lang.startsWith("en")) score += 6;
  else return -1000;

  if (/(natural|neural)/.test(name)) score += 60;
  if (/(enhanced|premium)/.test(name)) score += 35;
  if (/siri/.test(name)) score += 30;
  if (/google/.test(name)) score += 24;
  if (/online/.test(name)) score += 14;
  if (GOOD_VOICE_NAMES.test(name)) score += 10;
  if (NOVELTY_VOICES.test(name)) score -= 120;
  if (voice.localService) score += 4;
  if (voice.default) score += 3;

  return score;
}

function rankedVoices(): SpeechSynthesisVoice[] {
  const voices = getSynth()?.getVoices() ?? [];
  const unique = new Map<string, SpeechSynthesisVoice>();

  for (const voice of voices) {
    if (voice.lang.toLowerCase().startsWith("en")) unique.set(voice.voiceURI, voice);
  }

  return [...unique.values()].sort((a, b) => voiceScore(b) - voiceScore(a));
}

function voiceForSlot(slot: number): SpeechSynthesisVoice | null {
  const voices = rankedVoices();
  const signature = voices.map((voice) => voice.voiceURI).join("|");

  if (signature !== voiceSignature) {
    voiceSignature = signature;
    assignedVoices.clear();
  }

  if (voices.length === 0) return null;

  const existing = assignedVoices.get(slot);
  if (existing && voices.some((voice) => voice.voiceURI === existing.voiceURI)) {
    return existing;
  }

  const used = new Set([...assignedVoices.values()].map((voice) => voice.voiceURI));
  const choice = voices.find((voice) => !used.has(voice.voiceURI)) ?? voices[slot % voices.length];
  assignedVoices.set(slot, choice);
  return choice;
}

function whenVoicesReady(callback: () => void): void {
  const synth = getSynth();
  if (!synth) return;

  if (synth.getVoices().length > 0) {
    callback();
    return;
  }

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    synth.removeEventListener("voiceschanged", finish);
    callback();
  };
  const timer = window.setTimeout(finish, 900);
  synth.addEventListener("voiceschanged", finish);
}

function setActive(id: string | null, agentId: string | null): void {
  update({ activeId: id, activeAgentId: agentId });
}

function finishJob(): void {
  currentJob = null;
  setActive(null, null);

  if (queuedJobs.length > 0) {
    window.setTimeout(() => {
      if (!currentJob) beginNextJob();
    }, 90);
  }
}

function speakCurrentChunk(job: SpeechJob, token: number): void {
  if (token !== session || currentJob !== job) return;

  const synth = getSynth();
  if (!synth) {
    finishJob();
    return;
  }

  if (job.index >= job.chunks.length) {
    finishJob();
    return;
  }

  const text = job.chunks[job.index];
  if (!text) {
    job.index += 1;
    speakCurrentChunk(job, token);
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = voiceForSlot(job.voiceSlot);

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-US";
  }

  utterance.pitch = Math.min(1.25, Math.max(0.75, job.pitch));
  utterance.rate = Math.min(1.25, Math.max(0.75, job.rate));
  utterance.volume = 1;

  utterance.onstart = () => {
    if (token === session && currentJob === job && state.notice) {
      update({ notice: null });
    }
  };

  utterance.onend = () => {
    if (token !== session || currentJob !== job) return;
    job.index += 1;
    // A small breath between chunks sounds less like a machine racing through
    // paragraphs. It also keeps Chrome from cutting long speeches off.
    window.setTimeout(() => {
      if (token === session && currentJob === job) speakCurrentChunk(job, token);
    }, 110);
  };

  utterance.onerror = (event) => {
    if (token !== session || currentJob !== job) return;
    const error = (event as SpeechSynthesisErrorEvent).error;
    if (error === "canceled" || error === "interrupted") return;

    update({
      notice:
        error === "not-allowed"
          ? "The browser blocked automatic speech. Press a speaker button to start audio."
          : "This browser has no usable speech voices installed. Try another browser or enable system voices.",
    });
    finishJob();
  };

  synth.speak(utterance);
}

function beginNextJob(): void {
  if (currentJob || queuedJobs.length === 0) return;

  const job = queuedJobs.shift();
  if (!job) return;

  currentJob = job;
  session += 1;
  const token = session;
  setActive(job.id, job.agentId);

  whenVoicesReady(() => {
    if (token !== session || currentJob !== job) return;
    speakCurrentChunk(job, token);
  });
}

function makeJob(input: SpeakInput): SpeechJob | null {
  const value = speechText(input.text);
  if (!value) return null;

  const rawSlot = typeof input.voiceSlot === "number" ? Math.floor(input.voiceSlot) : undefined;
  const slot = rawSlot ?? (input.agentId ? hash(input.agentId) % 4 : 0);
  const profile = VOICE_PROFILES[Math.abs(slot) % VOICE_PROFILES.length];

  return {
    id: input.id,
    agentId: input.agentId ?? null,
    voiceSlot: Math.abs(slot),
    chunks: chunkSpeech(value),
    index: 0,
    rate: input.rate ?? profile.rate,
    pitch: input.pitch ?? profile.pitch,
  };
}

export function stopSpeech(): void {
  session += 1;
  queuedJobs = [];
  currentJob = null;
  getSynth()?.cancel();
  update({ activeId: null, activeAgentId: null, notice: null });
}

export function speakText(input: SpeakInput): boolean {
  if (isMutedId(input.agentId) || !getSynth()) return false;

  const job = makeJob(input);
  if (!job) return false;

  stopSpeech();
  queuedJobs = [job];
  beginNextJob();
  return true;
}

export function enqueueSpeech(input: SpeakInput): boolean {
  if (isMutedId(input.agentId) || !getSynth()) return false;
  if (currentJob?.id === input.id || queuedJobs.some((job) => job.id === input.id)) return true;

  const job = makeJob(input);
  if (!job) return false;

  queuedJobs.push(job);
  if (!currentJob) beginNextJob();
  return true;
}

export function toggleMuted(agentId: string | null | undefined): void {
  if (!agentId) return;

  const muted = state.mutedIds.includes(agentId);
  update({
    mutedIds: muted
      ? state.mutedIds.filter((id) => id !== agentId)
      : [...state.mutedIds, agentId],
  });
  persist();

  if (!muted) {
    queuedJobs = queuedJobs.filter((job) => job.agentId !== agentId);
    if (currentJob?.agentId === agentId) stopSpeech();
  }
}

export function setAutoRead(enabled: boolean): void {
  if (state.autoRead === enabled) return;
  autoReadPreferenceSet = true;
  update({ autoRead: enabled });
  persist();
  if (!enabled) stopSpeech();
}

/**
 * Applies a session default only when the visitor has never chosen an
 * auto-read preference. Live debates default on; archived debates default off.
 */
export function initializeAutoRead(enabled: boolean): void {
  hydrate();
  if (autoReadPreferenceSet) return;
  if (state.autoRead !== enabled) update({ autoRead: enabled });
}

export function useSpeech() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => DEFAULT_STATE);

  useEffect(() => {
    hydrate();
  }, []);

  return {
    ...snapshot,
    speakingId: snapshot.activeId,
    isMuted: (agentId?: string | null) => Boolean(agentId && snapshot.mutedIds.includes(agentId)),
    speak: speakText,
    enqueue: enqueueSpeech,
    stop: stopSpeech,
    toggleMuted,
    setAutoRead,
    initializeAutoRead,
  };
}
