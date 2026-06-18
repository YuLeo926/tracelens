import { describe, it, expect } from "vitest";
import { parseTrace } from "./parse";
import { spanMatchesQuery, searchTrace, errorSpanIds, slowestSpanId } from "./search";
import research from "../../public/samples/research-agent.json";
import toolError from "../../public/samples/tool-error.json";

const t = parseTrace(research);
const te = parseTrace(toolError);
const names = (ids: string[] | Set<string>) =>
  [...ids].map((id) => t.byId.get(id)!.name);

describe("spanMatchesQuery", () => {
  const root = t.roots[0];
  it("matches the span name, case-insensitively", () => {
    expect(spanMatchesQuery(root, "research")).toBe(true);
    expect(spanMatchesQuery(root, "RESEARCH")).toBe(true);
  });
  it("matches input text", () => {
    expect(spanMatchesQuery(root, "population")).toBe(true);
  });
  it("returns false for a non-match and for an empty query", () => {
    expect(spanMatchesQuery(root, "zzz-not-here")).toBe(false);
    expect(spanMatchesQuery(root, "")).toBe(false);
    expect(spanMatchesQuery(root, "   ")).toBe(false);
  });
});

describe("searchTrace", () => {
  it("returns all-empty for a blank query", () => {
    const r = searchTrace(t.roots, "  ");
    expect(r.matchIds.size).toBe(0);
    expect(r.visibleIds.size).toBe(0);
    expect(r.orderedMatchIds).toEqual([]);
  });

  it("keeps the ancestor chain of a match visible", () => {
    const r = searchTrace(t.roots, "retriever");
    expect(names(r.orderedMatchIds)).toEqual(["retriever.vector_search"]);
    expect(names(r.visibleIds).sort()).toEqual(
      ["research_agent.run", "retriever.vector_search", "tool.web_search"].sort(),
    );
  });

  it("orders matches in display (pre-order) order and excludes pure ancestors", () => {
    const r = searchTrace(t.roots, "llm.");
    expect(names(r.orderedMatchIds)).toEqual(["llm.plan", "llm.extract", "llm.answer"]);
    expect(r.matchIds.has(t.roots[0].spanId)).toBe(false);
    expect(r.visibleIds.has(t.roots[0].spanId)).toBe(true);
  });
});

describe("errorSpanIds", () => {
  it("finds error spans in display order", () => {
    const ids = errorSpanIds(te.roots);
    expect(ids).toHaveLength(1);
    expect(te.byId.get(ids[0])!.name).toBe("tool.web_search");
  });
  it("returns [] when there are no errors", () => {
    expect(errorSpanIds(t.roots)).toEqual([]);
  });
});

describe("slowestSpanId", () => {
  it("returns the id of the longest span", () => {
    expect(slowestSpanId(t.roots)).toBe(t.roots[0].spanId);
  });
  it("returns null for an empty forest", () => {
    expect(slowestSpanId([])).toBeNull();
  });
});
