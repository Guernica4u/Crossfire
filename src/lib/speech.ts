"use client";

import { useSyncExternalStore } from "react";

type SpeakInput = {
  id: string;
  text: string;
  agentId?: string | null;
  pitch?: number;
  rate?: number;
};

let activeId: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setActive(id: string | null) {
  if (activeId === id) return;
  activeId = id;
  listeners.forEach((listener) => listener());
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

function speechText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " Code block. ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stopSpeech(): void {
  getSynth()?.cancel();
  setActive(null);
}

export function speakText({ id, text, agentId, pitch, rate }: SpeakInput): boolean {
  const synth = getSynth();
  const value = speechText(text);
  if (!synth || !value) return false;

  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(value);
  const voices = synth.getVoices();
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  const pool = english.length > 0 ? english : voices;
  const seed = hash(agentId ?? id);
  const voice = pool.length > 0 ? pool[seed % pool.length] : null;

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-US";
  }

  // Different seats get subtly different cadences so the room does not sound
  // like one narrator reading every part.
  utterance.pitch = pitch ?? 0.9 + (seed % 13) / 50;
  utterance.rate = rate ?? 0.97 + (seed % 5) * 0.015;
  utterance.volume = 1;

  utterance.onend = () => {
    if (activeId === id) setActive(null);
  };
  utterance.onerror = () => {
    if (activeId === id) setActive(null);
  };

  setActive(id);
  synth.speak(utterance);
  return true;
}

export function useSpeech() {
  const speakingId = useSyncExternalStore(subscribe, () => activeId, () => null);
  return { speakingId, speak: speakText, stop: stopSpeech };
}
