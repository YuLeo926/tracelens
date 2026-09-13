// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHead, readTokenTotals, scanTraceFiles, type TraceFileRef } from "../lib/folderWatch";
import { useConversations } from "./useConversations";

vi.mock("../lib/folderWatch", () => ({ scanTraceFiles: vi.fn(), readHead: vi.fn(), readTokenTotals: vi.fn() }));

const directory = {} as FileSystemDirectoryHandle;
const file = (name: string, lastModified = 1): TraceFileRef => ({ name, lastModified, sizeBytes: lastModified * 10, handle: { name } as FileSystemFileHandle });
let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useConversations>;
function Probe({ dir }: { dir: FileSystemDirectoryHandle | null }) {
  latest = useConversations(dir);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(readHead).mockResolvedValue('{"type":"session_meta","payload":{"id":"s"}}\n');
  vi.mocked(readTokenTotals).mockResolvedValue({ tokensIn: 100, tokensOut: 10, cachedIn: 0 });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("useConversations refresh", () => {
  it("discovers additions, updates changed stats, reuses unchanged stats, and removes deleted files", async () => {
    vi.mocked(scanTraceFiles).mockResolvedValue([file("a.jsonl")]);
    await act(async () => root.render(<Probe dir={directory} />));
    expect(latest.conversations).toHaveLength(1);
    expect(latest.loading).toBe(false);

    vi.mocked(scanTraceFiles).mockResolvedValue([file("b.jsonl", 2), file("a.jsonl")]);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(latest.conversations.map((row) => row.name)).toEqual(["b.jsonl", "a.jsonl"]);
    expect(readTokenTotals).toHaveBeenCalledTimes(2);

    vi.mocked(scanTraceFiles).mockResolvedValue([file("a.jsonl", 3)]);
    vi.mocked(readTokenTotals).mockResolvedValue({ tokensIn: 300, tokensOut: 30, cachedIn: 0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(latest.conversations).toMatchObject([{ name: "a.jsonl", tokensIn: 300 }]);
    expect(latest.conversations).toHaveLength(1);
    expect(readTokenTotals).toHaveBeenCalledTimes(3);
  });

  it("retains the last list on a temporary scan error and recovers on the next poll", async () => {
    vi.mocked(scanTraceFiles).mockResolvedValue([file("a.jsonl")]);
    await act(async () => root.render(<Probe dir={directory} />));
    vi.mocked(scanTraceFiles).mockRejectedValueOnce(new Error("permission"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(latest.error).toBe(true);
    expect(latest.conversations).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(latest.error).toBe(false);
  });

  it("does not overlap slow scans or publish stale results after switching directories", async () => {
    let resolve!: (files: TraceFileRef[]) => void;
    vi.mocked(scanTraceFiles).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await act(async () => root.render(<Probe dir={directory} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(scanTraceFiles).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Probe dir={null} />));
    await act(async () => resolve([file("stale.jsonl")]));
    expect(latest.conversations).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
