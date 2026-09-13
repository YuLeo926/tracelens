// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharePreviewDialog } from "./SharePreviewDialog";
import { prepareSharePreview } from "../../core/sharePreview";
import { copyShareLinkToClipboard } from "./exportActions";

vi.mock("./exportActions", () => ({ copyShareLinkToClipboard: vi.fn() }));
let host: HTMLDivElement;
let root: Root;
const preview = prepareSharePreview(JSON.stringify({ spans: [
  { span_id: "a", name: "First event", start_time: 1, end_time: 2, attributes: { "input.value": "first input" } },
  { span_id: "b", name: "Second event", start_time: 2, end_time: 3, attributes: { "output.value": "second output" } },
] }));
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(copyShareLinkToClipboard).mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(key = 1) { await act(async () => root.render(<SharePreviewDialog key={key} preview={preview} intent="link" onClose={() => {}} />)); }
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!; }
async function click(element: HTMLElement) { await act(async () => element.click()); }

it("filters only the readable preview and exports the complete frozen snapshot after confirmation", async () => {
  vi.mocked(copyShareLinkToClipboard).mockResolvedValue(true);
  await mount();
  expect(button("Copy reviewed link").disabled).toBe(true);
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "First");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector('[aria-label="Export events"]')!.textContent).not.toContain("Second event");
  expect(host.textContent).toContain("export includes all 2 events");
  await click(button("Complete JSON"));
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(preview.source);
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await click(button("Copy reviewed link"));
  expect(copyShareLinkToClipboard).toHaveBeenCalledWith(expect.objectContaining({ rawSource: preview.source }));
  await mount(2);
  expect(button("Copy reviewed link").disabled).toBe(true);
});

it("prevents a late clipboard write after the review is closed", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const clipboard = vi.fn();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  vi.mocked(copyShareLinkToClipboard).mockImplementation(async ({ writeText }) => {
    await pending;
    try { await writeText("late link"); } catch { return false; }
    return true;
  });
  await mount();
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await click(button("Copy reviewed link"));
  await act(async () => root.render(null));
  await act(async () => { release(); await pending; });
  expect(clipboard).not.toHaveBeenCalled();
});

it("restores focus to a still-connected export trigger on close", async () => {
  const trigger = document.createElement("button"); document.body.append(trigger);
  await act(async () => root.render(<SharePreviewDialog preview={preview} intent="download" returnFocus={trigger} onClose={() => {}} />));
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
