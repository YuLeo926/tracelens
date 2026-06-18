import type { RunNode } from "../../core/types";
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

export function SpanDetail({ node }: { node: RunNode }) {
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
