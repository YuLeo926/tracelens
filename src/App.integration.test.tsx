// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { SessionSummary } from "./core/session/types";

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void; }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function trace(id: string) { return JSON.stringify([{ span_id: id, trace_id: `t-${id}`, name: `span-${id}`, start_time: 1, end_time: 2, attributes: {} }]); }
function summary(id: string, title = `Run ${id}`, eventId = `${id}-event`): SessionSummary {
  return { id, provider: "codex", title, project: "tracelens", modifiedAt: 100, sizeBytes: 1, lifecycle: "complete", match: "exact", selectionReason: "", facts: { lifecycle: "complete", totals: { durationMs: 1, tokensIn: 1, tokensOut: 1, toolCalls: 1, errors: 0 }, errorEvents: [], slowestEvents: [{ eventId, name: `Evidence ${eventId}`, kind: "tool", status: "ok", startMs: 1, durationMs: 1 }], highestTokenEvents: [], repeatedOperations: [] } };
}

class Api {
  sessions: SessionSummary[] = [];
  pending = new Map<string, Deferred<Response>[]>();
  calls: string[] = [];
  fetch = vi.fn<typeof fetch>((input) => {
    const url = String(input);
    if (url === "/api/sessions") return Promise.resolve(json(this.sessions));
    const id = decodeURIComponent(url.slice("/api/sessions/".length));
    this.calls.push(id);
    const next = deferred<Response>();
    this.pending.set(id, [...(this.pending.get(id) ?? []), next]);
    return next.promise;
  });
  resolve(id: string, item: SessionSummary, source = trace(`${id}-event`), index = 0) { this.pending.get(id)?.[index]?.resolve(json({ session: item, source })); }
  reject(id: string, message: string, index = 0) { this.pending.get(id)?.[index]?.reject(new Error(message)); }
}

let root: Root; let host: HTMLDivElement; let originalFetch: typeof fetch;
const token = "a".repeat(64);
const route = (id: string, event?: string) => `/?mode=session&session=${id}${event ? `&event=${event}` : ""}#token=${token}`;
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function mount(api: Api, path = "/") {
  window.history.replaceState(null, "", path); globalThis.fetch = api.fetch;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<App />)); await flush();
}
function button(text: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button ${text}`); return found;
}
function buttonContaining(text: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`Missing button containing ${text}`); return found;
}
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); }
async function resolve(api: Api, item: SessionSummary, source?: string) { await act(async () => api.resolve(item.id, item, source)); await flush(); }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; originalFetch = globalThis.fetch; localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => { callback(0); return 0; }) as typeof window.requestAnimationFrame;
});
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); globalThis.fetch = originalFetch; });

describe("App local session integration", () => {
  it("keeps a session-mode URL on the local path when a share-style hash is present", async () => {
    const api = new Api();
    await mount(api, "/?mode=session&session=local#t=share-token");
    expect(api.calls).toEqual([]);
    expect(host.textContent).toContain("Local session unavailable");
    expect(host.textContent).not.toContain("This share link could not be opened.");
  });

  it("prefers local mode over share hash and selects only valid evidence deep links", async () => {
    const api = new Api(); const local = summary("local", "Local", "known"); api.sessions = [local];
    await mount(api, route("local", "known"));
    expect(api.calls).toEqual(["local"]);
    await resolve(api, local, trace("known"));
    expect(host.textContent).toContain("Call tree");
    expect(host.querySelector('[data-span-id="known"]')).not.toBeNull();
    await act(async () => { window.history.pushState(null, "", route("local", "missing")); window.dispatchEvent(new PopStateEvent("popstate")); }); await flush();
    expect(host.textContent).toContain("Slowest events"); expect(host.textContent).not.toContain("Call tree");
  });

  it("rejects stale popstate loads and keeps a failed switch visible and retryable", async () => {
    const api = new Api(); const first = summary("first", "First"); const second = summary("second", "Second"); const third = summary("third", "Third"); api.sessions = [first, second, third];
    await mount(api, route("first"));
    await act(async () => { window.history.pushState(null, "", route("second")); window.dispatchEvent(new PopStateEvent("popstate")); }); await flush();
    await act(async () => { window.history.pushState(null, "", route("third")); window.dispatchEvent(new PopStateEvent("popstate")); }); await flush();
    await resolve(api, third); await act(async () => { api.resolve("first", first); api.resolve("second", second); }); await flush();
    expect(host.textContent).toContain("Third"); expect(host.textContent).not.toContain("Second");
    await click(button("Sessions")); await click(buttonContaining("First")); expect(host.textContent).toContain("Loading session...");
    await act(async () => api.reject("first", "That session is no longer available.", 1)); await flush();
    expect(host.textContent).toContain("Third"); expect(host.textContent).toContain("TraceLens could not load this session."); expect(host.textContent).toContain("Sessions");
    await click(buttonContaining("First")); expect(api.calls.filter((id) => id === "first")).toHaveLength(3);
  });

  it("writes session and evidence URLs, restores overview on popstate, traps focus, and resets to Loader", async () => {
    const api = new Api(); const current = summary("current", "Current", "evidence"); const replacement = summary("replacement", "Replacement", "evidence"); api.sessions = [current, replacement];
    await mount(api, route("current")); await resolve(api, current, trace("evidence"));
    const opener = button("Sessions"); await click(opener); const close = host.querySelector<HTMLButtonElement>('button[aria-label="Close session picker"]')!;
    close.focus(); await act(async () => close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))); expect(document.activeElement).not.toBe(document.body);
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await flush(); expect(document.activeElement).toBe(opener);
    await click(opener); await click(buttonContaining("Replacement")); expect(window.location.search).toBe("?mode=session&session=replacement"); expect(window.location.hash).toBe(`#token=${token}`);
    await resolve(api, replacement, trace("evidence")); const evidence = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Slowest event: Evidence evidence"))!;
    await click(evidence); expect(window.location.search).toBe("?mode=session&session=replacement&event=evidence");
    await act(async () => { window.history.pushState(null, "", route("replacement")); window.dispatchEvent(new PopStateEvent("popstate")); }); await flush(); expect(host.textContent).toContain("Slowest events");
    await click(button("New trace")); expect(window.location.search).toBe(""); expect(window.location.hash).toBe(""); expect(host.textContent).toContain("Drop a trace file here");
  });

  it("uses opaque local annotation keys while preserving manual Loader and label-based annotations", async () => {
    const api = new Api(); const local = summary("opaque-id", "Local annotation"); api.sessions = [local];
    await mount(api, route("opaque-id")); await resolve(api, local);
    await click([...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Slowest event"))!); await click(host.querySelector("aside button")!);
    expect(localStorage.getItem("tracelens:annotations")).toContain("session:opaque-id");
    await click(button("New trace")); const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "manual.json", text: async () => trace("manual-span") }] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); await flush(); expect(host.textContent).toContain("Call tree");
    await click(host.querySelector("aside button")!); expect(localStorage.getItem("tracelens:annotations")).toContain("manual.json");
  });
});
