// Pure: pull a human label (first user message + project) from the HEAD of a
// trace file, without a full parse. Knows Codex rollout and Claude transcript
// JSONL; returns {} for anything else (the UI falls back to the file name).

export interface ConversationMeta {
  title?: string;
  project?: string;
}

const MAX_TITLE = 120;

function blockText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((b) => (b && typeof b === "object" ? (b as { text?: unknown }).text : undefined))
      .filter((x): x is string => typeof x === "string");
    return parts.length ? parts.join("\n") : undefined;
  }
  return undefined;
}

function userText(rec: unknown): string | undefined {
  if (!rec || typeof rec !== "object") return undefined;
  const r = rec as { type?: unknown; payload?: { type?: unknown; role?: unknown; content?: unknown }; message?: { role?: unknown; content?: unknown } };
  // Codex rollout: { payload: { type: "message", role: "user", content } }
  if (r.payload && r.payload.type === "message" && r.payload.role === "user") {
    return blockText(r.payload.content);
  }
  // Claude transcript: { type: "user", message: { role: "user", content } }
  if (r.type === "user" && r.message && r.message.role === "user") {
    return blockText(r.message.content);
  }
  return undefined;
}

function cwdOf(rec: unknown): string | undefined {
  if (!rec || typeof rec !== "object") return undefined;
  const r = rec as { cwd?: unknown; payload?: { cwd?: unknown } };
  const cwd = (typeof r.payload?.cwd === "string" && r.payload.cwd) || (typeof r.cwd === "string" && r.cwd);
  return cwd || undefined;
}

function lastSegment(path: string): string | undefined {
  const segs = path.split(/[/\\]+/).filter(Boolean);
  return segs.length ? segs[segs.length - 1] : undefined;
}

function cleanTitle(raw: string): string {
  // Drop leading XML-ish tag blocks. Codex's first user turn is often ENTIRELY
  // an <environment_context>…</environment_context> (or <user_instructions>…)
  // block of injected boilerplate; the real ask is the next user message. Strip
  // those and return "" when nothing real remains so the caller moves on to the
  // next user message instead of showing the boilerplate.
  const stripped = raw.replace(/^\s*(<([a-zA-Z_][\w-]*)\b[^>]*>[\s\S]*?<\/\2>\s*)+/, "");
  const s = stripped.replace(/\s+/g, " ").trim();
  return s.length > MAX_TITLE ? s.slice(0, MAX_TITLE - 1) + "…" : s;
}

/** Extract a title + project from the head text of a trace file. */
export function extractConversationMeta(head: string): ConversationMeta {
  const records: unknown[] = [];
  for (const line of head.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      // partial/truncated last line — skip
    }
  }

  const meta: ConversationMeta = {};
  for (const r of records) {
    const cwd = cwdOf(r);
    if (cwd) {
      const seg = lastSegment(cwd);
      if (seg) meta.project = seg;
      break;
    }
  }
  for (const r of records) {
    const text = userText(r);
    if (!text) continue;
    const title = cleanTitle(text);
    if (title) {
      meta.title = title;
      break;
    }
  }
  return meta;
}
