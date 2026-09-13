import { useState } from "react";
import { ThemeToggle } from "../shell/ThemeToggle";
import { ConversationList } from "./ConversationList";
import { DashboardView } from "./DashboardView";
import type { Conversation } from "../../hooks/useConversations";
import type { DashboardModel } from "../../core/folderStats";
import type { RunErrors } from "../../hooks/useFailedScan";
import type { SessionSignal } from "../../core/session/types";
import { FolderOpen, Radio, X } from "lucide-react";

interface Props {
  folderName: string;
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
  dashboard: DashboardModel;
  failed: { errors: Map<string, RunErrors>; signals?: Map<string, SessionSignal[]>; done: number; total: number };
  onOpen: (name: string) => void;
  onFollowNewest: () => void;
  onClose: () => void;
  selectedName?: string;
}

export function FolderBrowser({
  folderName, conversations, loading, error, dashboard, failed, onOpen, onFollowNewest, onClose, selectedName,
}: Props) {
  const [tab, setTab] = useState<"overview" | "conversations">("conversations");
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);

  const pickProject = (project: string) => {
    setProjectFilter(project);
    setTab("conversations");
  };
  const tabBtn = (active: boolean) =>
    `rounded px-2 py-0.5 ${active ? "bg-elev text-text" : "text-muted hover:text-text"}`;

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-panel px-5 py-3">
        <span className="wordmark text-lg text-text">tracelens</span>
        <div className="flex items-center gap-2"><ThemeToggle /><button type="button" onClick={onClose} title="Close folder" aria-label="Close folder" className="icon-button"><X size={17} /></button></div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2 text-[12px]">
        <FolderOpen size={16} /><span className="min-w-0 max-w-full break-all text-text">{folderName}</span>
        <span className="text-faint">· {conversations.length} conversations</span>
        <div className="ml-2 flex gap-1">
          <button type="button" aria-pressed={tab === "conversations"} className={tabBtn(tab === "conversations")} onClick={() => setTab("conversations")}>Conversations</button>
          <button type="button" aria-pressed={tab === "overview"} className={tabBtn(tab === "overview")} onClick={() => setTab("overview")}>Overview</button>
        </div>
        <button type="button" onClick={onFollowNewest} className="ml-2 flex min-h-9 items-center gap-1.5 rounded border border-border px-2 text-text hover:bg-elev"><Radio size={15} />Follow newest (live)</button>
      </div>

      <div className="min-h-0 flex-1 flex-col" style={{ display: tab === "overview" ? "flex" : "none" }}>
        <DashboardView model={dashboard} failed={failed} conversations={conversations} onOpen={onOpen} onPickProject={pickProject} />
      </div>
      <div className="min-h-0 flex-1 flex-col" style={{ display: tab === "conversations" ? "flex" : "none" }}>
        {projectFilter && <div className="flex items-center gap-2 border-b border-border px-4 text-xs text-muted">Project: {projectFilter}<button type="button" className="icon-button" title="Clear project filter" aria-label="Clear project filter" onClick={() => setProjectFilter(undefined)}><X size={14} /></button></div>}
        <ConversationList conversations={conversations} loading={loading} error={error} onOpen={onOpen} projectFilter={projectFilter} signals={failed.signals} selectedName={selectedName} />
      </div>
    </div>
  );
}
