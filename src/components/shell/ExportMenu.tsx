import { useEffect, useRef, useState } from "react";
import type { ExportActions } from "./exportActions";

export function ExportMenu({ actions }: { actions: ExportActions }) {
  const { onCopyLink, onDownloadJson, canShare } = actions;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleCopy = async () => {
    await onCopyLink();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-text"
      >
        ⇪ Export
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1.5 w-48 overflow-hidden rounded-lg border border-border bg-panel py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleCopy}
            disabled={!canShare}
            title={canShare ? "" : "Sharing needs a newer browser"}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text hover:bg-panel-2 disabled:opacity-40"
          >
            🔗 {copied ? "Copied!" : "Copy share link"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDownloadJson();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text hover:bg-panel-2"
          >
            ⬇ Download JSON
          </button>
        </div>
      )}
    </div>
  );
}
