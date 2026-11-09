import { describe, expect, it } from "vitest";
import { debatesRemaining, nextStateAfterTurn, requiredCallsForDebate } from "@/lib/debate-state";

const base = {
  phase: "opening" as const,
  round: 0,
  rounds: 1,
  nextSpeakerIndex: 0,
};

describe("nextStateAfterTurn", () => {
  it("moves through the three openings", () => {
    expect(nextStateAfterTurn(base)).toEqual({
      phase: "opening",
      round: 0,
      nextSpeakerIndex: 1,
    });
    expect(nextStateAfterTurn({ ...base, nextSpeakerIndex: 2 })).toEqual({
      phase: "rebuttal",
      round: 1,
      nextSpeakerIndex: 0,
    });
  });

  it("moves from rebuttal to closing or the next round", () => {
    const rebuttal = { ...base, phase: "rebuttal" as const, round: 1, rounds: 2 };
    expect(nextStateAfterTurn({ ...rebuttal, nextSpeakerIndex: 0 }).nextSpeakerIndex).toBe(1);
    expect(nextStateAfterTurn({ ...rebuttal, nextSpeakerIndex: 2 })).toEqual({
      phase: "rebuttal",
      round: 2,
      nextSpeakerIndex: 0,
    });
    expect(
      nextStateAfterTurn({ ...rebuttal, round: 2, nextSpeakerIndex: 2 }),
    ).toEqual({
      phase: "closing",
      round: 2,
      nextSpeakerIndex: 0,
    });
  });

  it("hands the room to the judge after the closings", () => {
    expect(
      nextStateAfterTurn({
        ...base,
        phase: "closing",
        round: 1,
        nextSpeakerIndex: 2,
      }),
    ).toEqual({
      phase: "judging",
      round: 1,
      nextSpeakerIndex: 0,
    });
  });
});

describe("capacity math", () => {
  it("counts a quick debate as ten calls", () => {
    expect(requiredCallsForDebate(1)).toBe(10);
    expect(requiredCallsForDebate(2)).toBe(13);
  });

  it("estimates how many debates remain", () => {
    expect(debatesRemaining(50, 1)).toBe(5);
    expect(debatesRemaining(9, 1)).toBe(0);
    expect(debatesRemaining(null, 1)).toBeNull();
  });
});
