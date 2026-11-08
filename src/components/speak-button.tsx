"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useSpeech } from "@/lib/speech";
import { cn } from "@/lib/utils";

export function SpeakButton({
  id,
  text,
  agentId,
  voiceSlot,
  label = "Listen",
  mutedLabel = "Unmute voice",
  className,
}: {
  id: string;
  text: string;
  agentId?: string | null;
  voiceSlot?: number;
  label?: string;
  mutedLabel?: string;
  className?: string;
}) {
  const { speakingId, speak, stop, isMuted, toggleMuted } = useSpeech();
  const muted = isMuted(agentId);
  const active = speakingId === id && !muted;

  return (
    <button
      type="button"
      className={cn(
        "speak-button",
        active && "is-speaking",
        muted && "is-muted",
        !label && "speak-button-icon",
        className,
      )}
      data-muted={muted}
      aria-label={
        muted
          ? "Unmute this voice"
          : active
            ? "Stop reading aloud"
            : `Read ${label || "this turn"} aloud`
      }
      aria-pressed={active}
      title={
        muted
          ? "This voice is muted. Click to unmute it."
          : active
            ? "Stop reading aloud"
            : "Read aloud with your browser's best natural voice"
      }
      onClick={() => {
        if (muted) {
          toggleMuted(agentId);
          return;
        }
        if (active) {
          stop();
          return;
        }
        speak({ id, text, agentId, voiceSlot });
      }}
    >
      {active || muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
      {label ? <span>{muted ? mutedLabel : active ? "Stop" : label}</span> : null}
    </button>
  );
}
