import { VIEWS, type ViewId } from "../../lib/views";
import { ThemeToggle } from "./ThemeToggle";
import { Search, ListTree, ChartNoAxesCombined, GitCompare, NotebookPen, LayoutList } from "lucide-react";

const ICONS = { overview: LayoutList, tree: ListTree, flamegraph: ChartNoAxesCombined, diff: GitCompare, annotations: NotebookPen };

interface Props {
  activeView: ViewId;
  onSelectView: (id: ViewId) => void;
  showOverview?: boolean;
}

export function Rail({ activeView, onSelectView, showOverview = false }: Props) {
  return (
    <nav aria-label="Run views" className="workspace-nav flex w-[48px] shrink-0 flex-col items-center gap-1 border-r border-border bg-rail py-3">
      <div
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: "linear-gradient(135deg,var(--kind-agent),var(--kind-retriever))" }}
      >
        <Search size={17} className="text-white" aria-hidden="true" />
      </div>

      {VIEWS.filter((v) => v.id !== "overview" || showOverview).map((v) => {
        const active = v.id === activeView;
        const Icon = ICONS[v.id];
        return (
          <button
            key={v.id}
            onClick={() => onSelectView(v.id)}
            title={v.status === "soon" ? `${v.label} — coming in v1` : v.label}
            aria-label={v.label}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-[15px] ${v.id === "overview" ? "font-serif font-bold" : ""} ${
              active
                ? "bg-panel text-accent-strong shadow-sm"
                : "text-muted hover:bg-panel hover:text-text"
            }`}
          >
            <Icon size={18} />
            {v.status === "soon" && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-faint" />
            )}
          </button>
        );
      })}

      <div className="flex-1" />
      <ThemeToggle />
    </nav>
  );
}
