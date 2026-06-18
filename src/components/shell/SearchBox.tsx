import type { SearchControls } from "./searchControls";

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
      <span aria-hidden className="shrink-0 text-faint">🔍</span>
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
        className="min-w-0 flex-1 bg-transparent text-text placeholder:text-faint focus:outline-none"
      />
      {has ? (
        <>
          <span className="mono shrink-0 text-[11px] text-faint">
            {matchPosition} / {matchCount}
          </span>
          <button type="button" onClick={onPrev} disabled={matchCount === 0} aria-label="Previous match" className="shrink-0 px-0.5 text-muted hover:text-text disabled:opacity-40">⌃</button>
          <button type="button" onClick={onNext} disabled={matchCount === 0} aria-label="Next match" className="shrink-0 px-0.5 text-muted hover:text-text disabled:opacity-40">⌄</button>
          <button type="button" onClick={onClear} aria-label="Clear search" className="shrink-0 px-0.5 text-muted hover:text-text">×</button>
        </>
      ) : (
        <span className="mono ml-auto shrink-0 rounded border border-border px-1 text-[10px] text-faint">⌘K</span>
      )}
    </div>
  );
}
