import { SearchBox } from "./SearchBox";

interface Props {
  label: string;
  onReset: () => void;
}

export function TopBar({ label, onReset }: Props) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2.5">
      <span className="truncate text-[13px] font-semibold text-text">
        {label || "Untitled trace"}
      </span>
      <div className="ml-1 flex min-w-0 flex-1 justify-start">
        <SearchBox />
      </div>
      <button
        type="button"
        title="Export — coming in v1"
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-text"
      >
        ⇪ Export
      </button>
      <button
        onClick={onReset}
        className="shrink-0 rounded-lg border border-accent-strong bg-accent-strong px-3 py-1.5 text-[12px] text-on-accent hover:brightness-110"
      >
        New trace
      </button>
    </header>
  );
}
