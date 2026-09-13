import { useEffect, useRef, useState } from "react";
import type { ExportActions } from "./exportActions";
import { Upload, Link, Download } from "lucide-react";

export function ExportMenu({ actions }: { actions: ExportActions }) {
  const { onReviewExport, canShare } = actions;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
        if (!items.length) return;
        e.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(current + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleCopy = () => {
    setOpen(false);
    trigger.current?.focus();
    onReviewExport("link");
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-9 items-center gap-1.5 rounded border border-border px-2 text-xs text-muted hover:text-text"
      >
        <Upload size={15} /> Export
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
            <Link size={15} />Review share link
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              trigger.current?.focus();
              onReviewExport("download");
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text hover:bg-panel-2"
          >
            <Download size={15} />Review JSON export
          </button>
        </div>
      )}
    </div>
  );
}
