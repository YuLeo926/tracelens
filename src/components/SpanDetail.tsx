import type { RunNode } from "../core/types";
import { KindBadge } from "./KindBadge";
import { ERROR_COLOR } from "../lib/kinds";
import {
  formatDuration,
  formatTokens,
  formatCost,
  formatClock,
} from "../core/format";

const HANDLED_KEYS = [
  "input.value",
  "output.value",
  "tool.parameters",
  "llm.input_messages",
  "llm.output_messages",
];

function Field({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[11px] uppercase tracking-wider"
        style={{ color: "var(--muted-2)" }}
      >
        {label}
      </span>
      <span className="mono text-sm break-words" style={{ color: accent ?? "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}

function Block({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="text-[11px] uppercase tracking-wider"
        style={{ color: "var(--muted-2)" }}
      >
        {label}
      </span>
      <pre
        className="mono max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 text-[12.5px] leading-relaxed"
        style={{
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
      >
        {body}
      </pre>
    </div>
  );
}

export function SpanDetail({ node }: { node: RunNode }) {
  const otherAttrs = Object.entries(node.attributes).filter(
    ([k]) => !HANDLED_KEYS.includes(k),
  );

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <KindBadge kind={node.kind} />
          {node.status === "error" && (
            <span
              className="mono rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wider"
              style={{
                color: ERROR_COLOR,
                background: `${ERROR_COLOR}1a`,
                border: `1px solid ${ERROR_COLOR}33`,
              }}
            >
              error
            </span>
          )}
        </div>
        <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {node.name}
        </h2>
      </div>

      {node.status === "error" && node.statusMessage && (
        <div
          className="rounded-md p-3 text-sm"
          style={{
            background: `${ERROR_COLOR}12`,
            border: `1px solid ${ERROR_COLOR}40`,
            color: ERROR_COLOR,
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
        {node.costUsd ? (
          <Field label="Cost" value={formatCost(node.costUsd)} accent="var(--accent)" />
        ) : null}
        <Field label="Span ID" value={node.spanId} />
      </div>

      <Block label="Input" body={node.input} />
      <Block label="Output" body={node.output} />

      {otherAttrs.length > 0 && (
        <details>
          <summary
            className="cursor-pointer select-none text-[11px] uppercase tracking-wider"
            style={{ color: "var(--muted-2)" }}
          >
            Raw attributes ({otherAttrs.length})
          </summary>
          <pre
            className="mono mt-2 max-h-72 overflow-auto rounded-md p-3 text-[12px]"
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
            }}
          >
            {JSON.stringify(Object.fromEntries(otherAttrs), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
