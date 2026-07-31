import { describe, expect, it } from "vitest";
import { parseTrace } from "../parse";
import { buildRunFacts } from "./facts";

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
      },
    ]);
    expect(JSON.stringify(facts)).not.toMatch(/loop|root cause/i);
  });
});
