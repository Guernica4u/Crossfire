"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useSpeech } from "@/lib/speech";
import { cn } from "@/lib/utils";

export function SpeakButton({
  id,
  text,
  agentId,
  label = "Listen",
  className,
}: {
  id: string;
  text: string;
  agentId?: string | null;
  label?: string;
  className?: string;
}) {
  const { speakingId, speak, stop } = useSpeech();
  const active = speakingId === id;

  return (
    <button
      type="button"
      className={cn("speak-button", active && "is-speaking", !label && "speak-button-icon", className)}
      aria-label={active ? "Stop reading aloud" : `Read ${label || "this turn"} aloud`}
      aria-pressed={active}
      title={
        active
          ? "Stop reading aloud"
          : "Read aloud with your browser's built-in speech voices"
      }
      onClick={() => {
        if (active) {
          stop();
          return;
        }
        speak({ id, text, agentId });
      }}
    >
      {active ? <VolumeX size={12} /> : <Volume2 size={12} />}
      {label ? <span>{active ? "Stop" : label}</span> : null}
    </button>
  );
}
