import type { DashboardModel } from "../../core/folderStats";
import type { Conversation } from "../../hooks/useConversations";
import type { ScanState } from "../../hooks/useFailedScan";
import { formatTokens, formatCost, formatRelativeTime } from "../../core/format";

interface Props {
  model: DashboardModel;
  failed: { states: Map<string, ScanState>; done: number; total: number };
  conversations: Conversation[];
  onOpen: (name: string) => void;
  onPickProject: (project: string) => void;
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-panel px-4 py-3">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className="text-lg text-text">{value}</span>
    </div>
  );
}

export function DashboardView({ model, failed, conversations, onOpen, onPickProject }: Props) {
  const now = Date.now();
  const failedCount = [...failed.states.values()].filter((s) => s === "failed").length;
  const skipped = [...failed.states.values()].filter((s) => s === "skipped").length;
  const scanning = failed.done < failed.total;
  const maxDay = Math.max(1, ...model.activity.map((d) => d.count));
  const failedConvos = conversations.filter((c) => failed.states.get(c.name) === "failed");

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Conversations" value={String(model.conversationCount)} />
        <Card label="Tokens (in / out)" value={`${formatTokens(model.totalTokensIn)} / ${formatTokens(model.totalTokensOut)}`} />
        <Card label="Est. cost" value={`≈ ${formatCost(model.estCostUsd)}`} />
        <Card label="Failed runs" value={`${failedCount}${scanning ? ` · ${failed.done}/${failed.total}` : ""}`} />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-[11px] uppercase tracking-wider text-faint">Activity (last 14 days)</h3>
        <div className="flex h-24 items-end gap-1">
          {model.activity.map((d) => (
            <div
              key={d.day}
              className="flex-1 rounded-t bg-track"
              style={{ height: `${Math.max(2, (d.count / maxDay) * 100)}%`, background: d.count ? "var(--kind-agent)" : "var(--track)" }}
              title={`${d.day}: ${d.count}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-[11px] uppercase tracking-wider text-faint">By project</h3>
        <ul className="rounded-lg border border-border">
          {model.projects.map((p) => (
            <li key={p.project} className="border-b border-border last:border-0">
              <button
                type="button"
                onClick={() => onPickProject(p.project)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-panel-2"
              >
                <span className="min-w-0 flex-1 truncate text-text">{p.project}</span>
                <span className="text-faint">{p.count} runs</span>
                <span className="mono text-faint">{formatTokens(p.tokens)} tok</span>
                <span className="text-faint">{formatRelativeTime(p.lastActive, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-[11px] uppercase tracking-wider text-faint">
          Failed runs{scanning ? ` · analyzing ${failed.done}/${failed.total}` : ""}
          {skipped > 0 ? ` · ${skipped} too large, not analyzed` : ""}
        </h3>
        {failedConvos.length === 0 ? (
          <div className="rounded-lg border border-border p-4 text-sm text-muted">
            {scanning ? "Analyzing…" : "No failed runs found."}
          </div>
        ) : (
          <ul className="rounded-lg border border-border">
            {failedConvos.map((c) => (
              <li key={c.name} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => onOpen(c.name)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-panel-2"
                >
                  <span className="truncate text-[13px] text-text">{c.title ?? c.name}</span>
                  <span className="mono text-[11px] text-faint">{c.project ?? "—"} · {formatRelativeTime(c.lastModified, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
