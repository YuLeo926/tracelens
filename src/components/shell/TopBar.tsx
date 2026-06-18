import { SearchBox } from "./SearchBox";
import { ExportMenu } from "./ExportMenu";
import type { SearchControls } from "./searchControls";
import type { ExportActions } from "./exportActions";

interface Props {
  label: string;
  onReset: () => void;
  search: SearchControls;
  exportActions: ExportActions;
}

export function TopBar({ label, onReset, search, exportActions }: Props) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2.5">
      <span className="truncate text-[13px] font-semibold text-text">
        {label || "Untitled trace"}
      </span>
      <div className="ml-1 flex min-w-0 flex-1 justify-start">
        <SearchBox search={search} />
      </div>
      <button
        type="button"
        onClick={search.onJumpNextError}
        disabled={!search.active || search.errorCount === 0}
        title={search.errorCount === 0 ? "No errors" : "Jump to next error"}
        className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-muted hover:text-text disabled:opacity-40"
      >
        ⚠ Error
      </button>
      <button
        type="button"
        onClick={search.onJumpSlowest}
        disabled={!search.active}
        title="Jump to slowest span"
        className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-muted hover:text-text disabled:opacity-40"
      >
        ⏱ Slowest
      </button>
      <ExportMenu actions={exportActions} />
      <button
        onClick={onReset}
        className="shrink-0 rounded-lg border border-accent-strong bg-accent-strong px-3 py-1.5 text-[12px] text-on-accent hover:brightness-110"
      >
        New trace
      </button>
    </header>
  );
}
