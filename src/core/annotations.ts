import type { RunNode, SpanKind } from "./types";

export type Verdict = "good" | "bad";

export interface Annotation {
  verdict?: Verdict;
  tag?: string;
  note?: string;
}

export interface StoredAnnotation extends Annotation {
  name: string;
  kind: SpanKind;
  model?: string;
  input?: string;
  output?: string;
}

export interface AnnotationRow {
  conversation: string;
  span_id: string;
  name: string;
  kind: SpanKind;
  model: string;
  input: string;
  output: string;
  verdict: string;
  tag: string;
  note: string;
}

export const SNAPSHOT_CAP = 8000;
const CSV_CELL_CAP = 300;

/** True if the annotation carries any real content. */
export function isAnnotated(a: Annotation): boolean {
  return Boolean(a.verdict || a.tag?.trim() || a.note?.trim());
}

/** Editable fields + a capped snapshot of the span, for storage/export. */
export function toStored(a: Annotation, node: RunNode): StoredAnnotation {
  // Store values raw (trimming the live value would break typing in the
  // controlled input — a trailing space would be eaten on every keystroke);
  // trim is only used to decide whether a field counts as "present".
  const s: StoredAnnotation = { name: node.name, kind: node.kind };
  if (a.verdict) s.verdict = a.verdict;
  if (a.tag?.trim()) s.tag = a.tag;
  if (a.note?.trim()) s.note = a.note;
  if (node.model) s.model = node.model;
  if (node.input) s.input = node.input.slice(0, SNAPSHOT_CAP);
  if (node.output) s.output = node.output.slice(0, SNAPSHOT_CAP);
  return s;
}

/** Flatten a store ({label: {spanId: StoredAnnotation}}) to export rows. */
export function buildRows(
  store: Record<string, Record<string, StoredAnnotation>>,
  labels: string[],
): AnnotationRow[] {
  const rows: AnnotationRow[] = [];
  for (const label of labels) {
    const bucket = store[label];
    if (!bucket) continue;
    for (const [spanId, s] of Object.entries(bucket)) {
      rows.push({
        conversation: label,
        span_id: spanId,
        name: s.name,
        kind: s.kind,
        model: s.model ?? "",
        input: s.input ?? "",
        output: s.output ?? "",
        verdict: s.verdict ?? "",
        tag: s.tag ?? "",
        note: s.note ?? "",
      });
    }
  }
  return rows;
}

export function toJSONL(rows: AnnotationRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

const CSV_COLUMNS: Array<keyof AnnotationRow> = [
  "conversation", "span_id", "name", "kind", "model", "input", "output", "verdict", "tag", "note",
];

function csvCell(value: string, cap?: number): string {
  let v = cap !== undefined ? value.slice(0, cap) : value;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCSV(rows: AnnotationRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = rows.map((r) =>
    CSV_COLUMNS.map((c) =>
      csvCell(String(r[c]), c === "input" || c === "output" ? CSV_CELL_CAP : undefined),
    ).join(","),
  );
  return [header, ...body].join("\n");
}
