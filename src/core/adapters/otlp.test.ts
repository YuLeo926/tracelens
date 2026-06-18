import { describe, it, expect } from "vitest";
import { otlpAdapter } from "./otlp";
import { parseTrace, flatten } from "../parse";
import otlp from "../../../public/samples/otlp-trace.json";

describe("otlpAdapter.detect", () => {
  it("matches the OTLP shape only", () => {
    expect(otlpAdapter.detect({ resourceSpans: [] })).toBe(true);
    expect(otlpAdapter.detect({ resource_spans: [] })).toBe(true);
    expect(otlpAdapter.detect([{ span_id: "a" }])).toBe(false);
    expect(otlpAdapter.detect({ spans: [] })).toBe(false);
  });
});

describe("otlpAdapter.toLooseSpans", () => {
  const loose = otlpAdapter.toLooseSpans(otlp);
  it("flattens every span and unwraps attribute values", () => {
    expect(loose).toHaveLength(4);
    const plan = loose.find((s) => s.name === "llm.plan")!;
    expect(plan.attributes!["gen_ai.request.model"]).toBe("gpt-4o");
    expect(plan.attributes!["gen_ai.usage.input_tokens"]).toBe("320");
  });
  it("maps the OTLP error status and parent id", () => {
    const tool = loose.find((s) => s.name === "tool.web_search")!;
    expect(tool.status_code).toBe("ERROR");
    expect(tool.parent_span_id).toBe("b7ad6b7169203331");
  });
});

describe("OTLP end-to-end via parseTrace", () => {
  const t = parseTrace(otlp);
  it("builds the tree and maps gen_ai semantics + errors", () => {
    expect(t.summary.spanCount).toBe(4);
    expect(t.roots).toHaveLength(1);
    expect(t.roots[0].name).toBe("support_agent.run");
    const plan = flatten(t.roots).find((n) => n.name === "llm.plan")!;
    expect(plan.kind).toBe("llm");
    expect(plan.model).toBe("gpt-4o");
    expect(plan.tokensIn).toBe(320);
    expect(t.summary.errors).toBe(1);
  });
});
