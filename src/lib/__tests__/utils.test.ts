import { describe, expect, it } from "vitest";
import { capSpeechLength, sanitizeErrorText } from "@/lib/utils";
import { fallbackChain, retryDelayMs } from "@/lib/openrouter";

describe("error sanitizing", () => {
  it("removes markup and key-like strings", () => {
    const text = sanitizeErrorText(
      '<div>Provider said:</div> bad key sk-or-v1-abcdefghijklmnop',
    );
    expect(text).not.toContain("<div>");
    expect(text).not.toContain("sk-or-v1");
    expect(text).toContain("[redacted]");
  });
});

describe("speech length", () => {
  it("leaves a normal turn alone", () => {
    const text = "One two three four five.";
    expect(capSpeechLength(text, 10)).toBe(text);
  });

  it("cuts an essay at a sentence boundary", () => {
    const text = "This is a sentence with several words in it. ".repeat(20);
    const capped = capSpeechLength(text, 60);
    expect(capped.split(/\s+/).length).toBeLessThanOrEqual(61);
    expect(/[.…]$/.test(capped)).toBe(true);
  });
});

describe("fallback chain", () => {
  it("tries unused models before reusing an assigned one", () => {
    const chain = fallbackChain("google/gemma-4-31b-it:free", {
      avoid: ["nvidia/nemotron-3.5-lightning:free"],
    });
    expect(chain[0]).toBe("google/gemma-4-31b-it:free");
    expect(chain.indexOf("recursive/flint-v1.0:free")).toBeLessThan(
      chain.indexOf("nvidia/nemotron-3.5-lightning:free"),
    );
  });

  it("keeps retry delays short and jittered", () => {
    expect(retryDelayMs(0, 5000)).toBe(4000);
    expect(retryDelayMs(0)).toBeGreaterThanOrEqual(300);
  });
});
