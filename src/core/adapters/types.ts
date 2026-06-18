import type { LooseSpan } from "../openinference";

/** Converts one input trace format into the canonical LooseSpan[] the
    normalizer understands. Add a format by adding one of these. */
export interface TraceAdapter {
  id: string;
  label: string;
  detect(json: unknown): boolean;
  toLooseSpans(json: unknown): LooseSpan[];
}
