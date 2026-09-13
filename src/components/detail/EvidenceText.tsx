import { useMemo, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

export function EvidenceText({ label, body }: { label: string; body: string }) {
  const [expanded, setExpanded] = useState(false);
  const formatted = useMemo(() => {
    if (/^\s*[{[]/.test(body)) { try { return JSON.stringify(JSON.parse(body), null, 2); } catch { /* Plain log text. */ } }
    return body;
  }, [body]);
  return <section aria-label={label} className="min-w-0">
    <header className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold text-muted">{label}</h3>
      <button type="button" className="icon-button" aria-label={`${expanded ? "Collapse" : "Expand"} ${label.toLowerCase()}`} title={`${expanded ? "Collapse" : "Expand"} ${label.toLowerCase()}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
    </header>
    <pre className={`mono evidence-text overflow-auto whitespace-pre-wrap rounded border border-border bg-panel p-3 text-[13px] leading-relaxed text-text ${expanded ? "" : "max-h-72"}`}>{formatted}</pre>
  </section>;
}
