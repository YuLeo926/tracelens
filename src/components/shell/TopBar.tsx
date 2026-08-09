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
    <header className="grid min-w-0 grid-cols-1 gap-2 border-b border-border bg-panel px-4 py-2.5 lg:flex lg:items-center lg:gap-3">
      <div className="flex min-w-0 items-center justify-between gap-2 lg:contents">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text lg:max-w-[28vw] lg:flex-initial">
          {label || "Untitled trace"}
        </span>
        <button
          onClick={onReset}
          className="shrink-0 rounded-lg border border-accent-strong bg-accent-strong px-3 py-1.5 text-[12px] text-on-accent hover:brightness-110 lg:order-last"
        >
          New trace
        </button>
      </div>
      <div className="flex min-w-0 flex-1 justify-start lg:ml-1">
        <SearchBox search={search} />
      </div>
      <div className="grid min-w-0 grid-cols-3 gap-2 lg:contents">
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
      </div>
    </header>
  );
}
