// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseTraceText } from "../core/parse";
import { useTraceSearch } from "./useTraceSearch";

const trace = parseTraceText(JSON.stringify([
  { span_id: "first", name: "first error", start_time: 1, end_time: 2, status_code: "ERROR" },
  { span_id: "second", name: "second error", start_time: 2, end_time: 4, status_code: "ERROR" },
  { span_id: "third", name: "other event", start_time: 4, end_time: 5 },
]));
let root: Root; let host: HTMLDivElement;
let controls!: ReturnType<typeof useTraceSearch>;
const select = vi.fn();
function Harness({ selected = null, source = trace }: { selected?: string | null; source?: typeof trace }) {
  controls = useTraceSearch(source, selected, select);
  return null;
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; select.mockClear(); host = document.createElement("div"); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); });

it("wraps error navigation and clears filters that would hide the target", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => controls.onQueryChange("other"));
  await act(async () => controls.jumpPreviousError());
  expect(select).toHaveBeenLastCalledWith("second", true);
  expect(controls.query).toBe("");
  await act(async () => root.render(<Harness selected="second" />));
  await act(async () => controls.jumpNextError());
  expect(select).toHaveBeenLastCalledWith("first", true);
  await act(async () => controls.onQueryChange("other"));
  await act(async () => controls.jumpSlowest());
  expect(controls.query).toBe("");
  expect(select).toHaveBeenLastCalledWith("second", true);
});

it("clamps traversal when a live update reduces matching events", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => controls.onQueryChange("error"));
  await act(async () => controls.stepMatch(1));
  expect(controls.matchIndex).toBe(1);
  const reduced = parseTraceText(JSON.stringify([{ span_id: "first", name: "first error", start_time: 1, end_time: 2 }]));
  await act(async () => root.render(<Harness source={reduced} />));
  expect(controls.matchIndex).toBe(0);
  await act(async () => controls.stepMatch(-1));
  expect(select).toHaveBeenLastCalledWith("first", true);
});
