import { describe, expect, it } from "vitest";
import { parseTrace } from "../parse";
import {
  buildRunFacts,
  FACT_NAME_CHARS,
  REPEATED_EVENT_ID_LIMIT,
} from "./facts";

function span(
  spanId: string,
  startTime: number,
  kind: string,
  name: string,
  status: string,
  input: string,
) {
  return {
    span_id: spanId,
    trace_id: "trace-1",
    name,
    start_time: startTime,
    end_time: startTime + 1,
    status_code: status === "error" ? "ERROR" : "OK",
    attributes: {
      "openinference.span.kind": kind.toUpperCase(),
      "input.value": input,
    },
  };
}

describe("buildRunFacts", () => {
  it("reports repeated operations as facts without diagnosing a loop", () => {
    const trace = parseTrace([
      span("a", 0, "tool", "shell", "error", '{"command":"npm   test"}'),
      span("b", 2, "tool", "shell", "ok", '{"command":"npm test"}'),
      span("c", 4, "tool", "shell", "error", '{"command":"npm test"}'),
    ]);
    const facts = buildRunFacts(trace, "complete");
    expect(facts.repeatedOperations).toEqual([
      {
        operationName: "shell",
        count: 3,
        failureCount: 2,
        eventIds: ["a", "b", "c"],
        eventIdsOmitted: 0,
      },
    ]);
    expect(JSON.stringify(facts)).not.toMatch(/loop|root cause/i);
  });

  it("bounds fact labels and repeated-operation evidence with explicit omission counts", () => {
    const repeatedCount = REPEATED_EVENT_ID_LIMIT + 7;
    const longName = `shell-${"x".repeat(FACT_NAME_CHARS * 2)}`;
    const trace = parseTrace({
      spans: Array.from({ length: repeatedCount }, (_, index) =>
        span(`event-${index}`, index * 2, "tool", longName, "ok", '{"command":"npm test"}'),
      ),
    });

    const facts = buildRunFacts(trace, "complete");
    const repeated = facts.repeatedOperations[0];

    expect(repeated.operationName.length).toBeLessThanOrEqual(FACT_NAME_CHARS);
    expect(repeated.operationName.endsWith("...")).toBe(true);
    expect(repeated.eventIds).toHaveLength(REPEATED_EVENT_ID_LIMIT);
    expect(repeated.eventIdsOmitted).toBe(7);
    expect(repeated.count).toBe(repeatedCount);
    expect(facts.slowestEvents.every((event) => event.name.length <= FACT_NAME_CHARS)).toBe(true);
  });

  it("excludes zero-duration and zero-token events and reports a bounded token share", () => {
    const trace = parseTrace([
      {
        ...span("zero", 0, "tool", "zero", "ok", "{}"),
        end_time: 0,
      },
      {
        ...span("tokens", 2, "llm", "tokens", "ok", "{}"),
        attributes: {
          "openinference.span.kind": "LLM",
          "llm.token_count.prompt": 20,
          "llm.token_count.completion": 10,
        },
      },
    ]);

    const facts = buildRunFacts(trace, "complete");

    expect(facts.slowestEvents.map((event) => event.eventId)).toEqual(["tokens"]);
    expect(facts.highestTokenEvents).toEqual([
      expect.objectContaining({ eventId: "tokens", tokenSharePercent: 100 }),
    ]);
    expect(facts.highestTokenEvents.some((event) => event.eventId === "zero")).toBe(false);
    expect(facts.highestTokenEvents[0].tokenSharePercent).toBeGreaterThanOrEqual(0);
    expect(facts.highestTokenEvents[0].tokenSharePercent).toBeLessThanOrEqual(100);
  });
});
