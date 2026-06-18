export function SearchBox() {
  return (
    <button
      type="button"
      title="Search — coming in v1"
      aria-disabled="true"
      tabIndex={-1}
      className="flex min-w-0 max-w-[320px] flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 text-left text-[12px] text-faint"
    >
      <span aria-hidden>🔍</span>
      <span className="truncate">Search spans, jump to errors…</span>
      <span className="mono ml-auto rounded border border-border px-1 text-[10px]">⌘K</span>
    </button>
  );
}
