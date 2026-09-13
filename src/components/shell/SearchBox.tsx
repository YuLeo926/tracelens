import type { SearchControls } from "./searchControls";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";

export function SearchBox({ search }: { search: SearchControls }) {
  const {
    query, onQueryChange, matchCount, matchPosition,
    onPrev, onNext, onClear, inputRef, active,
  } = search;
  const has = query.trim().length > 0;

  return (
    <div
      className={`flex min-w-0 max-w-[360px] flex-1 items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-1 text-[12px] ${active ? "" : "opacity-50"}`}
    >
      <Search size={15} aria-hidden className="shrink-0 text-muted" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={!active}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClear();
            e.currentTarget.blur();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
        placeholder="Search spans, jump to errors…"
        aria-label="Search spans"
        className="h-7 min-w-0 flex-1 bg-transparent text-text placeholder:text-muted focus:outline-none"
      />
      {has ? (
        <>
          <span className="mono shrink-0 text-[11px] text-faint">
            {matchPosition} / {matchCount}
          </span>
          <button type="button" onClick={onPrev} disabled={matchCount === 0} aria-label="Previous match" title="Previous match" className="flex h-7 w-7 shrink-0 items-center justify-center text-muted hover:text-text disabled:opacity-40"><ChevronUp size={16} /></button>
          <button type="button" onClick={onNext} disabled={matchCount === 0} aria-label="Next match" title="Next match" className="flex h-7 w-7 shrink-0 items-center justify-center text-muted hover:text-text disabled:opacity-40"><ChevronDown size={16} /></button>
          <button type="button" onClick={onClear} aria-label="Clear search" title="Clear search" className="flex h-7 w-7 shrink-0 items-center justify-center text-muted hover:text-text"><X size={16} /></button>
        </>
      ) : null}
    </div>
  );
}
