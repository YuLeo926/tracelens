import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedTrace } from "../core/types";
import { errorSpanIds, searchTrace, slowestSpanId } from "../core/search";

export function useTraceSearch(trace: ParsedTrace | null, selectedId: string | null, onSelect: (id: string, reveal?: boolean) => void) {
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const search = useMemo(() => trace ? searchTrace(trace.roots, query) : null, [trace, query]);
  const errors = useMemo(() => trace ? errorSpanIds(trace.roots) : [], [trace]);
  const matchCount = search?.orderedMatchIds.length ?? 0;
  const currentMatchIndex = Math.min(matchIndex, Math.max(0, matchCount - 1));
  const onQueryChange = useCallback((value: string) => {
    setQuery(value); setMatchIndex(0);
    const first = trace ? searchTrace(trace.roots, value).orderedMatchIds[0] : undefined;
    if (first) onSelect(first);
  }, [trace, onSelect]);
  const clearSearch = useCallback(() => { setQuery(""); setMatchIndex(0); }, []);
  const stepMatch = useCallback((delta: number) => {
    if (!search?.orderedMatchIds.length) return;
    const next = (currentMatchIndex + delta + search.orderedMatchIds.length) % search.orderedMatchIds.length;
    setMatchIndex(next); onSelect(search.orderedMatchIds[next], true);
  }, [search, currentMatchIndex, onSelect]);
  const stepError = useCallback((delta: number) => {
    if (!errors.length) return;
    const current = errors.indexOf(selectedId ?? "");
    const next = current < 0 ? (delta > 0 ? 0 : errors.length - 1) : (current + delta + errors.length) % errors.length;
    clearSearch();
    onSelect(errors[next], true);
  }, [errors, selectedId, onSelect, clearSearch]);
  const jumpSlowest = useCallback(() => {
    const id = trace ? slowestSpanId(trace.roots) : null;
    if (id) { clearSearch(); onSelect(id, true); }
  }, [trace, onSelect, clearSearch]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && searchInputRef.current?.getClientRects().length) {
        event.preventDefault(); searchInputRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { query, search, errors, matchIndex: currentMatchIndex, matchCount, searchInputRef, onQueryChange, clearSearch, stepMatch, jumpSlowest,
    jumpNextError: () => stepError(1), jumpPreviousError: () => stepError(-1), errorPosition: errors.indexOf(selectedId ?? "") + 1 };
}
