import type { ReactNode } from "react";
import type { TraceSummary } from "../../core/types";
import type { ViewId } from "../../lib/views";
import type { SearchControls } from "./searchControls";
import type { ExportActions } from "./exportActions";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { SummaryStrip } from "./SummaryStrip";

interface Props {
  activeView: ViewId;
  onSelectView: (id: ViewId) => void;
  label: string;
  summary: TraceSummary;
  onReset: () => void;
  search: SearchControls;
  exportActions: ExportActions;
  children: ReactNode; // the view | detail split
}

export function AppShell({ activeView, onSelectView, label, summary, onReset, search, exportActions, children }: Props) {
  return (
    <div className="flex h-full bg-bg">
      <Rail activeView={activeView} onSelectView={onSelectView} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar label={label} onReset={onReset} search={search} exportActions={exportActions} />
        <SummaryStrip summary={summary} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {children}
        </div>
      </main>
    </div>
  );
}
