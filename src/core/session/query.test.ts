import { describe, expect, it } from "vitest";
import { parseTrace } from "../parse";
import { createSessionQuery } from "./query";
import type { EventDetail } from "./types";

function detailStringCharacters(detail: EventDetail): number {
  const fields = [
    detail.eventId,
    detail.name,
    detail.kind,
    detail.status,
    detail.inputSnippet,
    detail.outputSnippet,
    detail.statusMessage,
    detail.input,
    detail.output,
  ];
  return (
    fields.reduce((total, value) => total + (value?.length ?? 0), 0) +
    Object.entries(detail.attributes).reduce(
      (total, [key, value]) => total + key.length + (typeof value === "string" ? value.length : 0),
      0,
    )
  );
}

function toolSpan(index: number, overrides: Record<string, unknown> = {}) {
  return {
    span_id: `tool-${index}`,
    trace_id: "trace-1",
    name: `shell-${index}`,
    start_time: index,
    end_time: index + 1,
    status_code: index % 2 === 0 ? "ERROR" : "OK",
    attributes: {
      "openinference.span.kind": "TOOL",
      "input.value": `input ${index}`,
      "output.value": `output ${index}`,
      primitive: `attribute ${index}`,
      ...overrides,
    },
  };
}

function traceWithTools(count: number) {
  return parseTrace(Array.from({ length: count }, (_, index) => toolSpan(index + 1)));
}

function traceWithOutput(output: string) {
  return parseTrace([toolSpan(1, { "output.value": output })]);
}

describe("createSessionQuery", () => {
  it("caps timeline pages at fifty events", () => {
    const query = createSessionQuery(traceWithTools(75));
    const first = query.timeline({ limit: 999 });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe("50");
    expect(query.timeline({ cursor: first.nextCursor }).items).toHaveLength(25);
  });

  it("caps every string-bearing detail field at twenty-four thousand characters", () => {
    const query = createSessionQuery(traceWithOutput("x".repeat(30_000)));
    const detail = query.detail("tool-1")!;
    expect(detailStringCharacters(detail)).toBeLessThanOrEqual(24_000);
    expect(detail.inputSnippet).toBeUndefined();
    expect(detail.outputSnippet).toBeUndefined();
    expect(detail.truncated.output).toBe(true);
  });

  it("bounds long attributes in the total detail budget and redacts attribute keys", () => {
    const absolutePathKey = "C:\\Users\\alice\\transcript.txt";
    const query = createSessionQuery(
      parseTrace([
        {
          ...toolSpan(1, {
            "input.value": "i".repeat(30_000),
            "output.value": "o".repeat(30_000),
            transcript: "t".repeat(30_000),
            [absolutePathKey]: "a".repeat(30_000),
          }),
          name: "n".repeat(1_000),
          status_message: "s".repeat(1_000),
        },
      ]),
    );
    const detail = query.detail("tool-1")!;

    expect(detailStringCharacters(detail)).toBeLessThanOrEqual(24_000);
    expect(detail.inputSnippet).toBeUndefined();
    expect(detail.outputSnippet).toBeUndefined();
    expect(detail.truncated.attributes).toBe(true);
    expect(Object.keys(detail.attributes)).not.toContain(absolutePathKey);
  });

  it("redacts absolute paths in detail attribute keys", () => {
    const absolutePathKey = "C:\\Users\\alice\\transcript.txt";
    const query = createSessionQuery(
      parseTrace([toolSpan(1, { [absolutePathKey]: "readable value" })]),
    );

    expect(query.detail("tool-1")!.attributes["<absolute-path>"]).toBe("readable value");
  });

  it("caps search results, filters timeline events, and searches literal text case-insensitively", () => {
    const query = createSessionQuery(traceWithTools(30));
    expect(query.search({ query: "SHELL" }).items).toHaveLength(20);
    expect(query.search({ query: "attribute 2" }).items.map((event) => event.eventId)).toEqual([
      "tool-2",
      "tool-20",
      "tool-21",
      "tool-22",
      "tool-23",
      "tool-24",
      "tool-25",
      "tool-26",
      "tool-27",
      "tool-28",
      "tool-29",
    ]);
    expect(query.timeline({ kinds: ["tool"], status: "error" }).items.every((event) => event.status === "error")).toBe(true);
  });

  it("rejects invalid cursors and returns null for unknown event IDs", () => {
    const query = createSessionQuery(traceWithTools(2));
    for (const cursor of ["-1", "1.5", "1e2", "nope"]) {
      expect(() => query.timeline({ cursor })).toThrow("Invalid cursor.");
    }
    expect(query.detail("missing")).toBeNull();
  });

  it("redacts every query surface that exposes trace text", () => {
    const trace = parseTrace([
      {
        ...toolSpan(1, {
          "input.value": "C:\\Users\\alice\\input.txt",
          "output.value": "\\\\server\\share\\output.txt",
          path: "/var/tmp/attribute.txt",
        }),
        name: "/var/tmp/shell",
        status_message: "C:\\Users\\alice\\status.txt",
      },
    ]);
    const query = createSessionQuery(trace);
    const preview = query.timeline().items[0];
    const detail = query.detail("tool-1")!;

    expect(preview.name).toBe("<absolute-path>");
    expect(preview.inputSnippet).toBe("<absolute-path>");
    expect(preview.outputSnippet).toBe("<absolute-path>");
    expect(preview.statusMessage).toBe("<absolute-path>");
    expect(detail.attributes.path).toBe("<absolute-path>");
  });
});
