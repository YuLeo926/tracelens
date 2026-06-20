import { describe, it, expect } from "vitest";
import { VIEWS, DEFAULT_VIEW } from "./views";

describe("views registry", () => {
  it("has unique ids", () => {
    const ids = VIEWS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has the tree and flamegraph ready", () => {
    const ready = VIEWS.filter((v) => v.status === "ready").map((v) => v.id);
    expect(ready).toEqual(["tree", "flamegraph"]);
  });

  it("defaults to a view that is ready", () => {
    const def = VIEWS.find((v) => v.id === DEFAULT_VIEW);
    expect(def?.status).toBe("ready");
  });

  it("every view has a label and an icon glyph", () => {
    for (const v of VIEWS) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.icon.length).toBeGreaterThan(0);
    }
  });
});
