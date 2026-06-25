import { useState } from "react";
import { ThemeToggle } from "../shell/ThemeToggle";
import { ConversationList } from "./ConversationList";
import { DashboardView } from "./DashboardView";
import type { Conversation } from "../../hooks/useConversations";
import type { DashboardModel } from "../../core/folderStats";
import type { RunErrors } from "../../hooks/useFailedScan";

interface Props {
  folderName: string;
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
  dashboard: DashboardModel;
  failed: { errors: Map<string, RunErrors>; done: number; total: number };
  onOpen: (name: string) => void;
  onFollowNewest: () => void;
  onClose: () => void;
}

export function FolderBrowser({
  folderName, conversations, loading, error, dashboard, failed, onOpen, onFollowNewest, onClose,
}: Props) {
  const [tab, setTab] = useState<"overview" | "conversations">("overview");
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
        <ThemeToggle />
      </header>

      <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2 text-[12px]">
        <span className="text-text">📂 {folderName}</span>
        <span className="text-faint">· {conversations.length} conversations</span>
        <div className="ml-2 flex gap-1">
          <button type="button" className={tabBtn(tab === "overview")} onClick={() => setTab("overview")}>Overview</button>
          <button type="button" className={tabBtn(tab === "conversations")} onClick={() => { setProjectFilter(undefined); setTab("conversations"); }}>Conversations</button>
        </div>
        <button type="button" onClick={onFollowNewest} className="ml-2 rounded border border-accent px-2 py-0.5 text-text hover:bg-elev">📡 Follow newest (live)</button>
        <button type="button" onClick={onClose} className="ml-auto rounded border border-border px-2 py-0.5 text-text hover:border-accent">Close</button>
      </div>

      {tab === "overview" ? (
        <DashboardView model={dashboard} failed={failed} conversations={conversations} onOpen={onOpen} onPickProject={pickProject} />
      ) : (
        <ConversationList conversations={conversations} loading={loading} error={error} onOpen={onOpen} projectFilter={projectFilter} />
      )}
    </div>
  );
}
