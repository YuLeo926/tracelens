import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Loader } from "./Loader";
import { SpanDetail } from "./detail/SpanDetail";
import { SessionOverview } from "./session/SessionOverview";
import { browserSessionSummary } from "../core/session/browserSummary";
import { parseTraceText } from "../core/parse";
import { ThemeProvider } from "../theme/ThemeProvider";

const source = JSON.stringify([0, 1].map((i) => ({ span_id: `tool-${i}`, name: "shell", start_time: i + 1, end_time: i + 2, status_code: "ERROR", status_message: "Command failed", attributes: { "openinference.span.kind": "TOOL", "input.value": "npm test", "output.value": "Failure evidence" } })));

describe("evidence-first workflow", () => {
  it("places failure evidence before collapsed annotations", () => {
    const trace = parseTraceText(source);
    const html = renderToStaticMarkup(<SpanDetail node={trace.roots[0]} onAnnotate={() => {}} />);
    expect(html.indexOf("Command failed")).toBeLessThan(html.indexOf("Annotations"));
    expect(html.indexOf("Failure evidence")).toBeLessThan(html.indexOf("Annotations"));
    expect(html).toContain('<summary');
    expect(html).toContain('aria-label="Mark as helpful"');
  });
  it("has a real file-import button for keyboard users", () => {
    const html = renderToStaticMarkup(<ThemeProvider><Loader onLoad={() => {}} onError={() => {}} /></ThemeProvider>);
    expect(html).toMatch(/<button[^>]*>[^<]*Choose trace file/);
    expect(html).toContain("Connect ChatGPT / Codex");
    expect(html).toContain("#analyze-a-codex-run");
  });
  it("shows a shared factual overview without duplicating repeated operations", () => {
    const trace = parseTraceText(source);
    const summary = browserSessionSummary(trace, "manual.json", source);
    expect(summary.lifecycle).toBe("unknown");
    expect(summary.facts.totals.errors).toBe(2);
    const html = renderToStaticMarkup(<SessionOverview session={summary} onOpenEvent={() => {}} />);
    expect(html.match(/Repeated operation: shell/g)).toHaveLength(1);
    expect(html).toContain("Unknown");
  });
});
