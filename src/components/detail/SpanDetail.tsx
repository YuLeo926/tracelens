import type { RunNode } from "../../core/types";
import type { Annotation, StoredAnnotation } from "../../core/annotations";
import { KindBadge } from "./KindBadge";
import { formatDuration, formatTokens, formatCost, formatClock } from "../../core/format";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { EvidenceText } from "./EvidenceText";

const HANDLED_KEYS = [
  "input.value",
  "output.value",
  "tool.parameters",
  "llm.input_messages",
  "llm.output_messages",
];

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={`mono evidence-text text-[13px] ${accent ? "text-accent-strong" : "text-text"}`}>
        {value}
      </span>
    </div>
  );
}

function Block({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return <EvidenceText label={label} body={body} />;
}

function AnnotationControl({
  annotation, onAnnotate, knownTags,
}: {
  annotation?: StoredAnnotation;
  onAnnotate: (a: Annotation) => void;
  knownTags: string[];
}) {
  const verdict = annotation?.verdict;
  const tag = annotation?.tag ?? "";
  const note = annotation?.note ?? "";
  const update = (patch: Partial<Annotation>) => onAnnotate({ verdict, tag, note, ...patch });
  const btn = (active: boolean) =>
    `rounded border px-2 py-1 text-sm ${active ? "border-accent bg-elev" : "border-border hover:border-accent"}`;

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex gap-2">
        <button type="button" title="Mark as helpful" aria-label="Mark as helpful" aria-pressed={verdict === "good"} className={btn(verdict === "good")} onClick={() => update({ verdict: verdict === "good" ? undefined : "good" })}><ThumbsUp size={16} /></button>
        <button type="button" title="Mark as unhelpful" aria-label="Mark as unhelpful" aria-pressed={verdict === "bad"} className={btn(verdict === "bad")} onClick={() => update({ verdict: verdict === "bad" ? undefined : "bad" })}><ThumbsDown size={16} /></button>
      </div>
      <input
        list="tracelens-ann-tags"
        aria-label="Annotation tag"
        value={tag}
        onChange={(e) => update({ tag: e.target.value })}
        placeholder="tag (e.g. hallucination)"
        className="rounded border border-border bg-bg px-2 py-1 text-[13px] text-text outline-none focus:border-accent"
      />
      <datalist id="tracelens-ann-tags">
        {knownTags.map((t) => <option key={t} value={t} />)}
      </datalist>
      <textarea
        aria-label="Annotation note"
        value={note}
        onChange={(e) => update({ note: e.target.value })}
        placeholder="note…"
        rows={2}
        className="resize-y rounded border border-border bg-bg px-2 py-1 text-[13px] text-text outline-none focus:border-accent"
      />
    </div>
  );
}

export function SpanDetail({
  node, annotation, onAnnotate, knownTags = [],
}: {
  node: RunNode;
  annotation?: StoredAnnotation;
  onAnnotate?: (a: Annotation) => void;
  knownTags?: string[];
}) {
  const otherAttrs = Object.entries(node.attributes).filter(([k]) => !HANDLED_KEYS.includes(k));
  const isError = node.status === "error";

  return (
    <div className="flex min-w-0 flex-col gap-5 p-4 lg:p-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <KindBadge kind={node.kind} />
          {isError && (
            <span
              className="mono rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wider text-error"
              style={{
                background: "color-mix(in srgb, var(--error) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)",
              }}
            >
              error
            </span>
          )}
        </div>
        <h2 className="evidence-text text-base font-semibold text-text">{node.name}</h2>
      </div>

      {isError && node.statusMessage && (
        <div
          className="evidence-text rounded border-l-2 p-3 text-sm leading-relaxed text-error"
          style={{
            background: "color-mix(in srgb, var(--error) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 35%, transparent)",
          }}
        >
          {node.statusMessage}
        </div>
      )}

      <Block label="Input" body={node.input} />
      <Block label="Output" body={node.output} />

      <div className="grid min-w-0 grid-cols-2 gap-4 border-t border-border pt-4">
        <Field label="Duration" value={formatDuration(node.durationMs)} />
        <Field label="Started" value={formatClock(node.startMs)} />
        {node.model && <Field label="Model" value={node.model} />}
        {node.tokensIn !== undefined || node.tokensOut !== undefined ? (
          <Field
            label="Tokens in / out"
            value={`${formatTokens(node.tokensIn)} / ${formatTokens(node.tokensOut)}`}
          />
        ) : null}
        {node.costUsd !== undefined ? <Field label="Cost subtotal" value={formatCost(node.costUsd)} accent /> : null}
        <Field label="Span ID" value={node.spanId} />
      </div>

      {otherAttrs.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-xs text-muted">
            Raw attributes ({otherAttrs.length})
          </summary>
          <pre className="mono mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-panel p-3 text-[12px] text-muted">
            {JSON.stringify(Object.fromEntries(otherAttrs), null, 2)}
          </pre>
        </details>
      )}
      {onAnnotate && <details className="border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted">Annotations{annotation ? " (saved)" : ""}</summary>
        <AnnotationControl annotation={annotation} onAnnotate={onAnnotate} knownTags={knownTags} />
      </details>}
    </div>
  );
}
