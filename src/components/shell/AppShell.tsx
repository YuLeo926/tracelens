import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { TraceSummary } from "../../core/types";
import type { ViewId } from "../../lib/views";
import type { SearchControls } from "./searchControls";
import type { ExportActions } from "./exportActions";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { SummaryStrip } from "./SummaryStrip";

interface Props {
  activeView: ViewId; onSelectView: (id: ViewId) => void; label: string; summary: TraceSummary;
  onReset: () => void; search: SearchControls; exportActions: ExportActions; showOverview?: boolean;
  banner?: ReactNode; children: ReactNode; detail?: ReactNode; selectedEventId?: string | null;
  mobileDetailOpen?: boolean; onBackToEvents?: () => void; onOpenSessions?: () => void;
  sessionsButtonRef?: RefObject<HTMLButtonElement>;
}

export function AppShell({ activeView, onSelectView, label, summary, onReset, search, exportActions, showOverview = false, banner, children, detail, selectedEventId, mobileDetailOpen = false, onBackToEvents, onOpenSessions, sessionsButtonRef }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setCollapsed(false); }, [selectedEventId, activeView]);
  useEffect(() => {
    if (mobileDetailOpen && backButton.current?.getClientRects().length) backButton.current.focus();
  }, [mobileDetailOpen, selectedEventId]);
  return <div className="workspace-shell flex h-full min-w-0 bg-bg" data-mobile-detail={mobileDetailOpen && !!detail}>
    <Rail activeView={activeView} onSelectView={onSelectView} showOverview={showOverview} />
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="workspace-toolbar">
        <TopBar label={label} onReset={onReset} search={search} exportActions={exportActions} onOpenSessions={onOpenSessions} sessionsButtonRef={sessionsButtonRef} />
        {activeView !== "overview" && <SummaryStrip summary={summary} />}
      </div>
      {banner}
      <div className="workspace-grid min-h-0 flex-1" data-has-detail={!!detail} data-detail-collapsed={collapsed}>
        <div className="workspace-primary relative flex min-h-0 min-w-0 flex-col">
          {detail && collapsed && <button type="button" title="Show details" aria-label="Show details" className="detail-toggle icon-button absolute right-2 top-1 z-10 bg-panel" onClick={() => setCollapsed(false)}><PanelRightOpen size={17} /></button>}
          {children}
        </div>
        {detail && <aside className="workspace-detail flex min-h-0 min-w-0 flex-col border-l border-border bg-bg" aria-label="Event evidence">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <button ref={backButton} type="button" className="mobile-back flex min-h-9 items-center gap-2 text-sm text-text" onClick={onBackToEvents}><ArrowLeft size={17} />Back to events</button>
            <span className="detail-toggle text-xs font-semibold text-muted">Event evidence</span>
            <button type="button" title="Hide details" aria-label="Hide details" className="detail-toggle icon-button" onClick={() => setCollapsed(true)}><PanelRightClose size={17} /></button>
          </header>
          <div key={selectedEventId} className="min-h-0 flex-1 overflow-auto">{detail}</div>
        </aside>}
      </div>
    </main>
  </div>;
}
