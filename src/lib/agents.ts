import type { AgentPreset, ModelOption } from "@/lib/types";

export const MODEL_CATALOG: ModelOption[] = [
  {
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 · 31B",
    family: "Google",
    note: "Strong all-rounder",
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Gemma 4 · 26B A4B",
    family: "Google",
    note: "Fast, lighter Gemma",
  },
  {
    id: "nvidia/nemotron-3.5-lightning:free",
    label: "Nemotron 3.5 Lightning",
    family: "NVIDIA",
    note: "Fast reasoning model",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron 3 Ultra",
    family: "NVIDIA",
    note: "Heavyweight judge",
  },
  {
    id: "xingchen-agi/xing4.0-29b-a4b:free",
    label: "XingChen 4.0 · 29B",
    family: "XingChen",
    note: "Distinct voice",
  },
  {
    id: "recursive/flint-v1.0:free",
    label: "Flint v1.0",
    family: "Recursive",
    note: "Experimental free model",
  },
  {
    id: "liquid/lfm-3-1.7b:free",
    label: "LFM3 · 1.7B",
    family: "Liquid AI",
    note: "Small and quick",
  },
  {
    id: "openrouter/free",
    label: "Auto · Free Router",
    family: "OpenRouter",
    note: "Picks an available free model",
  },
];

export const DEFAULT_JUDGE_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

export const FALLBACK_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "recursive/flint-v1.0:free",
  "xingchen-agi/xing4.0-29b-a4b:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
];

export const AGENT_PRESETS: AgentPreset[] = [
  {
    key: "logician",
    name: "The Logician",
    tagline: "Premise by premise",
    color: "#8ab4ff",
    defaultStance: "for",
    defaultModel: "google/gemma-4-31b-it:free",
    persona:
      "You are The Logician: a precise, analytic philosopher. You care about definitions, hidden premises, logical validity, and counterexamples. You are calm, rigorous, and willing to grant a point when the reasoning is sound. You dislike slogans and vague appeals.",
  },
  {
    key: "skeptic",
    name: "The Skeptic",
    tagline: "Show me the evidence",
    color: "#ffb86b",
    defaultStance: "against",
    defaultModel: "nvidia/nemotron-3.5-lightning:free",
    persona:
      "You are The Skeptic: sharp, evidence-focused, and allergic to unexamined assumptions. You ask what would count as evidence, separate confidence from certainty, and press on contradictions. You are not cynical for its own sake; you want beliefs to earn their keep.",
  },
  {
    key: "humanist",
    name: "The Humanist",
    tagline: "What does this mean for us?",
    color: "#c99bff",
    defaultStance: "undecided",
    defaultModel: "xingchen-agi/xing4.0-29b-a4b:free",
    persona:
      "You are The Humanist: humane, narrative-driven, and attentive to lived experience. You connect abstract arguments to consequences, meaning, dignity, and the people affected. You are open to being moved, but you resist false comfort and cheap cynicism.",
  },
];

export const JUDGE_PRESET = {
  key: "arbiter",
  name: "The Arbiter",
  tagline: "Weighs the argument, not the volume",
  color: "#d7ff64",
  persona:
    "You are The Arbiter, an impartial debate judge. You reward valid reasoning, responsive argument, concrete evidence, intellectual honesty, and clarity. You penalize repetition, evasion, fabricated facts, and mere rhetoric. You do not care which model produced which argument.",
};

export function getModel(modelId: string): ModelOption {
  return (
    MODEL_CATALOG.find((model) => model.id === modelId) ?? {
      id: modelId,
      label: modelId,
      family: "OpenRouter",
      note: "Free model",
    }
  );
}

export function getPreset(key: string): AgentPreset | undefined {
  return AGENT_PRESETS.find((preset) => preset.key === key);
}

export function getJudgeModel(): string {
  return DEFAULT_JUDGE_MODEL;
}
