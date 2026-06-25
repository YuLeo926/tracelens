import { useState } from "react";
import type { StoredAnnotation } from "../../core/annotations";
import { buildRows, toJSONL, toCSV } from "../../core/annotations";
import { loadStore } from "../../lib/annotationStore";

// Save via the File System Access "Save As" dialog when available (lets the
// user choose the location); fall back to a normal browser download otherwise.
async function download(filename: string, text: string, mime: string) {
  const picker = (window as unknown as {
    showSaveFilePicker?: (o: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }>;
  }).showSaveFilePicker;

  if (picker) {
    try {
      const ext = filename.slice(filename.lastIndexOf("."));
      const handle = await picker({
        suggestedName: filename,
        types: [{ accept: { [mime.split(";")[0]]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // user cancelled the dialog
      // any other error: fall through to the normal download
    }
  }

  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface Props {
  annotations: Record<string, StoredAnnotation>;
  label: string;
  onSelect: (spanId: string) => void;
}

export function AnnotationsView({ annotations, label, onSelect }: Props) {
  const [scope, setScope] = useState<"this" | "all">("this");
  const entries = Object.entries(annotations);

  const rowsFor = (which: "this" | "all") => {
    if (which === "this") return buildRows({ [label]: annotations }, [label]);
    const store = loadStore();
    return buildRows(store, Object.keys(store));
  };
  const canExport = rowsFor(scope).length > 0;

  const doExport = (fmt: "jsonl" | "csv") => {
    const rows = rowsFor(scope);
    if (rows.length === 0) return;
    if (fmt === "jsonl") {
      void download("annotations.jsonl", toJSONL(rows), "application/x-ndjson");
    } else {
      // Prepend a UTF-8 BOM so Excel reads non-ASCII (e.g. Chinese) correctly.
      void download("annotations.csv", String.fromCharCode(0xFEFF) + toCSV(rows), "text/csv;charset=utf-8");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px]">
        <span className="text-faint">Export</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "this" | "all")}
          className="rounded border border-border bg-bg px-2 py-0.5 text-text"
        >
          <option value="this">This conversation</option>
          <option value="all">All conversations</option>
        </select>
        <button type="button" disabled={!canExport} onClick={() => doExport("jsonl")} className="rounded border border-border px-2 py-0.5 text-text hover:border-accent disabled:opacity-40">JSONL</button>
        <button type="button" disabled={!canExport} onClick={() => doExport("csv")} className="rounded border border-border px-2 py-0.5 text-text hover:border-accent disabled:opacity-40">CSV</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="p-6 text-sm text-muted">No annotations yet — open a span and rate it 👍/👎.</div>
        ) : (
          <ul>
            {entries.map(([spanId, a]) => (
              <li key={spanId} className="border-b border-border">
                <button
                  type="button"
                  onClick={() => onSelect(spanId)}
                  className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-panel-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px]">{a.verdict === "good" ? "👍" : a.verdict === "bad" ? "👎" : "📝"}</span>
                    <span className="truncate text-sm text-text">{a.name}</span>
                    {a.tag && <span className="mono rounded border border-border bg-bg px-1 text-[10px] text-muted">{a.tag}</span>}
                  </div>
                  {a.note && <div className="mono w-full truncate text-[11px] text-faint">{a.note}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
