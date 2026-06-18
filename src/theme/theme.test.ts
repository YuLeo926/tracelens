import { describe, it, expect } from "vitest";
import { resolveTheme, THEME_KEY } from "./theme";

describe("resolveTheme", () => {
  it("uses a valid stored value over system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("falls back to system preference when nothing is stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("ignores an invalid stored value and uses system preference", () => {
    expect(resolveTheme("purple", true)).toBe("dark");
    expect(resolveTheme("", false)).toBe("light");
  });

  it("exposes a stable storage key", () => {
    expect(THEME_KEY).toBe("tracelens.theme");
  });
});
