import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, List, X } from "lucide-react";
import { copyShareLinkToClipboard } from "./exportActions";
import type { SharePreview } from "../../core/sharePreview";
import { parseTraceText } from "../../core/parse";
import { EvidenceText } from "../detail/EvidenceText";

export function SharePreviewDialog({ preview, intent, onClose, returnFocus }: { preview: SharePreview; intent: "link" | "download"; onClose: () => void; returnFocus?: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"events" | "json">("events");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const alive = useRef(true);
  const events = useMemo(() => [...parseTraceText(preview.source).byId.values()], [preview.source]);
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? events.filter((event) => JSON.stringify({ ...event, children: undefined }).toLowerCase().includes(term)) : events;
  }, [events, query]);
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => {
      alive.current = false; element?.close();
      queueMicrotask(() => { if (returnFocus?.isConnected && !document.querySelector("dialog[open]")) returnFocus.focus(); });
    };
  }, [returnFocus]);
  const perform = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      if (intent === "link") {
        const ok = await copyShareLinkToClipboard({ rawSource: preview.source, label: preview.name, baseUrl: location.origin + location.pathname, writeText: (value) => {
          if (!alive.current) throw new Error("Export review closed");
          return navigator.clipboard.writeText(value);
        } });
        if (alive.current) setMessage(ok ? "Link copied." : "Could not copy the link. Download JSON for large traces.");
      } else {
        const url = URL.createObjectURL(new Blob([preview.source], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${preview.name}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("Download started.");
      }
    } catch { if (alive.current) setMessage("Export failed. Try again."); }
    finally { if (alive.current) setBusy(false); }
  };
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="share-preview-title" className="m-auto w-[min(52rem,calc(100vw-1rem))] max-h-[calc(100dvh-1rem)] overflow-auto rounded-lg border border-border bg-panel p-4 text-text backdrop:bg-black/40">
    <header className="flex items-center justify-between gap-2"><h2 id="share-preview-title" className="text-sm font-semibold">Review export</h2><button autoFocus type="button" title="Close" aria-label="Close export preview" onClick={onClose} className="icon-button"><X size={16} /></button></header>
    <p className="my-2 text-[12px] text-muted">{preview.spanCount} events. Common credentials and absolute paths masked; private code and conversation text may remain. Anyone with the link can read the export.</p>
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Preview format" className="flex rounded border border-border p-0.5">
        <button type="button" aria-pressed={mode === "events"} onClick={() => setMode("events")} className={`flex items-center gap-1 rounded px-2 py-1.5 text-[12px] ${mode === "events" ? "bg-elev text-text" : "text-muted"}`}><List size={14} />Events</button>
        <button type="button" aria-pressed={mode === "json"} onClick={() => setMode("json")} className={`flex items-center gap-1 rounded px-2 py-1.5 text-[12px] ${mode === "json" ? "bg-elev text-text" : "text-muted"}`}><Braces size={14} />Complete JSON</button>
      </div>
      {mode === "events" && <input type="search" aria-label="Filter export events" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(50); }} placeholder="Filter events" className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1.5 text-[12px]" />}
    </div>
    {mode === "json" ? <textarea aria-label="Export content" readOnly value={preview.source} className="mono h-[min(45dvh,24rem)] w-full resize-none rounded border border-border bg-bg p-2 text-[12px]" /> : <>
      <p role="status" className="mb-2 text-[12px] text-muted">{Math.min(limit, matches.length)} of {matches.length} matching events; export includes all {events.length} events.</p>
      <div aria-label="Export events" className="h-[min(45dvh,24rem)] overflow-auto border-y border-border">
        {matches.length === 0 && <p className="p-3 text-[12px] text-muted">No matching events.</p>}
        {matches.slice(0, limit).map((event) => <details key={event.spanId} className="border-b border-border px-2 py-2">
          <summary className="cursor-pointer text-[12px] [overflow-wrap:anywhere]"><span className={event.status === "error" ? "text-error" : "text-muted"}>{event.status} / {event.kind}</span> {event.name}</summary>
          <div className="space-y-3 py-3">
            {event.statusMessage !== undefined && <EvidenceText label="Error / status" body={event.statusMessage} />}
            {event.input !== undefined && <EvidenceText label="Input" body={event.input} />}
            {event.output !== undefined && <EvidenceText label="Output" body={event.output} />}
            <EvidenceText label="Event metadata" body={JSON.stringify({ ...event, children: undefined, input: undefined, output: undefined }, null, 2)} />
          </div>
        </details>)}
        {matches.length > limit && <button type="button" onClick={() => setLimit((value) => value + 50)} className="m-2 rounded border border-border px-3 py-2 text-[12px]">Show more events</button>}
      </div>
    </>}
    <label className="my-3 flex items-start gap-2 text-[12px]"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />I reviewed this content for private information.</label>
    <footer className="flex flex-wrap items-center justify-between gap-2"><span role="status" className="text-[12px] text-muted">{message}</span><button type="button" onClick={() => { void perform(); }} disabled={!confirmed || busy} className="rounded border border-accent bg-elev px-3 py-2 text-[12px] disabled:opacity-40">{busy ? "Exporting..." : intent === "link" ? "Copy reviewed link" : "Download reviewed JSON"}</button></footer>
  </dialog>;
}
