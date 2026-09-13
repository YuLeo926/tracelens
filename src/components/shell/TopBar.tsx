import type { RefObject } from "react";
import { ChevronLeft, ChevronRight, Timer, FolderOpen, FilePlus2 } from "lucide-react";
import { SearchBox } from "./SearchBox";
import { ExportMenu } from "./ExportMenu";
import type { SearchControls } from "./searchControls";
import type { ExportActions } from "./exportActions";

interface Props {
  label: string; onReset: () => void; search: SearchControls; exportActions: ExportActions;
  onOpenSessions?: () => void; sessionsButtonRef?: RefObject<HTMLButtonElement>;
}

export function TopBar({ label, onReset, search, exportActions, onOpenSessions, sessionsButtonRef }: Props) {
  return <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2">
    {onOpenSessions && <button ref={sessionsButtonRef} type="button" onClick={onOpenSessions} className="flex min-h-9 items-center gap-1.5 rounded border border-border px-2 text-xs text-text"><FolderOpen size={15} />Sessions</button>}
    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text lg:max-w-[220px]" title={label}>{label || "Untitled trace"}</span>
    <button type="button" onClick={onReset} title="New trace" className="flex min-h-9 shrink-0 items-center gap-1.5 rounded border border-border px-2 text-xs text-muted lg:order-last"><FilePlus2 size={15} />New trace</button>
    {search.active && <div className="order-2 w-full min-w-0 lg:order-none lg:w-auto lg:flex-1"><SearchBox search={search} /></div>}
    <div className={`${search.active ? "order-3 w-full lg:order-none lg:w-auto" : ""} flex flex-wrap items-center gap-2`}>
      {search.active && <><div role="group" aria-label="Error navigation" className="flex h-9 items-center rounded border border-border">
        <button type="button" className="icon-button" title="Previous error" aria-label="Previous error" disabled={!search.active || !search.errorCount} onClick={search.onJumpPreviousError}><ChevronLeft size={16} /></button>
        <span className="min-w-[72px] text-center text-xs text-muted" aria-live="polite">{search.errorPosition ?? 0}/{search.errorCount} errors</span>
        <button type="button" className="icon-button" title="Next error" aria-label="Next error" disabled={!search.active || !search.errorCount} onClick={search.onJumpNextError}><ChevronRight size={16} /></button>
      </div>
      <button type="button" className="icon-button border border-border" title="Slowest event" aria-label="Slowest event" disabled={!search.active} onClick={search.onJumpSlowest}><Timer size={17} /></button></>}
      <div className="ml-auto lg:ml-0"><ExportMenu actions={exportActions} /></div>
    </div>
  </header>;
}
