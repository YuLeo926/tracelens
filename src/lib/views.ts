// The viewer's view registry. The Rail renders one button per entry; the App
// renders the matching view. New v1 views (flamegraph, diff) become real by
// swapping their stub component and flipping status to "ready".

export type ViewId = "tree" | "flamegraph" | "diff";
export type ViewStatus = "ready" | "soon";

export interface ViewDef {
  id: ViewId;
  label: string;
  icon: string; // single glyph shown in the rail
  status: ViewStatus;
}

export const VIEWS: ViewDef[] = [
  { id: "tree", label: "Call tree", icon: "▤", status: "ready" },
  { id: "flamegraph", label: "Flamegraph", icon: "▦", status: "soon" },
  { id: "diff", label: "Diff", icon: "⇄", status: "soon" },
];

export const DEFAULT_VIEW: ViewId = "tree";
