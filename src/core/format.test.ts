import { describe, expect, it } from "vitest";
import { formatCost, formatRelativeTime } from "./format";

describe("formatRelativeTime", () => {
  const now = 1_000_000_000_000;
  it("formats recent times", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("formatCost", () => {
  it("shows a real zero cost instead of the missing-value placeholder", () => {
    expect(formatCost(0)).toBe("$0.00");
  });
});
