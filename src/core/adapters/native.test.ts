import { describe, it, expect } from "vitest";
import { nativeAdapter } from "./native";
import { extractSpansAuto } from "./index";

describe("nativeAdapter", () => {
  it("detects a bare array and { spans } / { data }, not OTLP", () => {
    expect(nativeAdapter.detect([{ span_id: "a" }])).toBe(true);
    expect(nativeAdapter.detect({ spans: [] })).toBe(true);
    expect(nativeAdapter.detect({ data: [] })).toBe(true);
    expect(nativeAdapter.detect({ resourceSpans: [] })).toBe(false);
  });

  it("extracts spans from each shape", () => {
    expect(nativeAdapter.toLooseSpans([{ span_id: "a" }])).toHaveLength(1);
    expect(
      nativeAdapter.toLooseSpans({ spans: [{ span_id: "a" }, { span_id: "b" }] }),
    ).toHaveLength(2);
  });

  it("extractSpansAuto routes a bare array to native", () => {
    expect(extractSpansAuto([{ span_id: "a" }])).toHaveLength(1);
  });
});
