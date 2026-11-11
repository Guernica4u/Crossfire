import { describe, expect, it } from "vitest";
import { publicLabel } from "@/lib/pool";

describe("pool labels", () => {
  it("keeps an ordinary provider label", () => {
    expect(publicLabel("Free tier")).toBe("Free tier");
  });

  it("drops full and masked key labels", () => {
    expect(publicLabel("sk-or-v1-49b1234567890abcdef")).toBeNull();
    expect(publicLabel("sk-or-v1-49b...98c")).toBeNull();
  });

  it("returns null for empty values", () => {
    expect(publicLabel("   ")).toBeNull();
    expect(publicLabel(null)).toBeNull();
  });
});
