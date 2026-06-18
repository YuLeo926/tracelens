import { VIEWS, type ViewId } from "../../lib/views";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  activeView: ViewId;
  onSelectView: (id: ViewId) => void;
}

export function Rail({ activeView, onSelectView }: Props) {
  return (
    <nav className="flex w-[50px] flex-col items-center gap-1 border-r border-border bg-rail py-3">
      <div
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: "linear-gradient(135deg,var(--kind-agent),var(--kind-retriever))" }}
      >
        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="14" cy="14" r="8.5" fill="none" stroke="#fff" strokeWidth="2.6" />
          <line x1="20" y1="20" x2="26" y2="26" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
      </div>

      {VIEWS.map((v) => {
        const active = v.id === activeView;
        return (
          <button
            key={v.id}
            onClick={() => onSelectView(v.id)}
            title={v.status === "soon" ? `${v.label} — coming in v1` : v.label}
            aria-label={v.label}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-[15px] ${
              active
                ? "bg-panel text-accent-strong shadow-sm"
                : "text-muted hover:bg-panel hover:text-text"
            }`}
          >
            {v.icon}
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
