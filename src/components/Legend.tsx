import { KIND_STYLES } from "../lib/kinds";

const SHOWN: Array<keyof typeof KIND_STYLES> = ["agent", "llm", "tool", "retriever"];

export function Legend() {
  return (
    <div className="hidden items-center gap-3 md:flex">
      {SHOWN.map((k) => (
        <span
          key={k}
          className="flex items-center gap-1.5 text-[11px]"
          style={{ color: "var(--muted)" }}
        >
          <span
            className="h-2 w-2 rounded-sm"
            style={{ background: KIND_STYLES[k].color }}
          />
          {KIND_STYLES[k].label}
        </span>
      ))}
    </div>
  );
}
