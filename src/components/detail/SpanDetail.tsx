import type { RunNode } from "../../core/types";
import type { Annotation, StoredAnnotation } from "../../core/annotations";
import { KindBadge } from "./KindBadge";
import { formatDuration, formatTokens, formatCost, formatClock } from "../../core/format";

const HANDLED_KEYS = [
  "input.value",
  "output.value",
  "tool.parameters",
  "llm.input_messages",
  "llm.output_messages",
];

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className={`mono break-words text-[13px] ${accent ? "text-accent-strong" : "text-text"}`}>
        {value}
      </span>
    </div>
  );
}

function Block({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <pre className="mono max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-panel p-3 text-[12.5px] leading-relaxed text-text">
        {body}
      </pre>
    </div>
  );
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
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3">
      <span className="text-[10px] uppercase tracking-wider text-faint">Annotation</span>
      <div className="flex gap-2">
        <button type="button" className={btn(verdict === "good")} onClick={() => update({ verdict: verdict === "good" ? undefined : "good" })}>👍</button>
        <button type="button" className={btn(verdict === "bad")} onClick={() => update({ verdict: verdict === "bad" ? undefined : "bad" })}>👎</button>
      </div>
      <input
        list="tracelens-ann-tags"
        value={tag}
        onChange={(e) => update({ tag: e.target.value })}
        placeholder="tag (e.g. hallucination)"
        className="rounded border border-border bg-bg px-2 py-1 text-[13px] text-text outline-none focus:border-accent"
      />
      <datalist id="tracelens-ann-tags">
        {knownTags.map((t) => <option key={t} value={t} />)}
      </datalist>
      <textarea
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
    <div className="flex flex-col gap-5 p-5">
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
        <h2 className="text-base font-semibold text-text">{node.name}</h2>
      </div>

      {onAnnotate && (
        <AnnotationControl annotation={annotation} onAnnotate={onAnnotate} knownTags={knownTags} />
      )}

      {isError && node.statusMessage && (
        <div
          className="rounded-lg p-3 text-sm text-error"
          style={{
            background: "color-mix(in srgb, var(--error) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 35%, transparent)",
          }}
        >
          {node.statusMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Duration" value={formatDuration(node.durationMs)} />
        <Field label="Started" value={formatClock(node.startMs)} />
        {node.model && <Field label="Model" value={node.model} />}
        {node.tokensIn || node.tokensOut ? (
          <Field
            label="Tokens in / out"
            value={`${formatTokens(node.tokensIn)} / ${formatTokens(node.tokensOut)}`}
          />
        ) : null}
        {node.costUsd ? <Field label="Cost" value={formatCost(node.costUsd)} accent /> : null}
        <Field label="Span ID" value={node.spanId} />
      </div>

      <Block label="Input" body={node.input} />
      <Block label="Output" body={node.output} />

      {otherAttrs.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider text-faint">
            Raw attributes ({otherAttrs.length})
          </summary>
          <pre className="mono mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-panel p-3 text-[12px] text-muted">
            {JSON.stringify(Object.fromEntries(otherAttrs), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
