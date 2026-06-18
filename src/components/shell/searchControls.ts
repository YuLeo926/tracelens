import type { RefObject } from "react";

/** Everything the top-bar search UI needs, provided by App. */
export interface SearchControls {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  matchPosition: number; // 1-based; 0 when there are no matches
  onPrev: () => void;
  onNext: () => void;
  onClear: () => void;
  inputRef: RefObject<HTMLInputElement>;
  onJumpNextError: () => void;
  onJumpSlowest: () => void;
  errorCount: number;
  active: boolean; // controls are enabled only on the tree view
}
