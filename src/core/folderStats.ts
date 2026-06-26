export interface ConvStat {
  name: string;
  project?: string;
  startMs?: number;
  lastModified: number;
  tokensIn?: number;     // total prompt tokens (INCLUDING cached)
  cachedIn?: number;     // the cached subset of tokensIn (billed ~10x cheaper)
  cacheWriteIn?: number;  // Claude cache creation tokens, billed separately
  tokensOut?: number;
  model?: string;
  sizeBytes: number;
}

export interface ProjectRow { project: string; count: number; tokens: number; lastActive: number; }
export interface DayBar { day: string; count: number; }

export interface DashboardModel {
  conversationCount: number;
  totalTokensIn: number;
  totalCachedIn: number;
  totalTokensOut: number;
  estCostUsd: number;
  projects: ProjectRow[];
  activity: DayBar[];
}

function parseLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      /* skip partial/truncated lines */
    }
  }
  return out;
}

/** Codex cumulative tokens = the LAST token_count event in the tail.
 *  `input_tokens` is the TOTAL prompt (Codex re-sends context each turn), of
 *  which `cached_input_tokens` is the cheap cached subset. */
interface TokenTotals {
  tokensIn: number;
  tokensOut: number;
  cachedIn: number;
  cacheWriteIn?: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function usageOf(record: unknown): Record<string, unknown> | undefined {
  if (!record || typeof record !== "object") return undefined;
  const r = record as {
    usage?: unknown;
    message?: { usage?: unknown };
    response?: { usage?: unknown };
  };
  const usage = r.message?.usage ?? r.response?.usage ?? r.usage;
  return usage && typeof usage === "object" ? usage as Record<string, unknown> : undefined;
}

export function extractTokens(tail: string): TokenTotals | null {
  let codexFound: TokenTotals | null = null;
  const claudeSum: Required<TokenTotals> = { tokensIn: 0, tokensOut: 0, cachedIn: 0, cacheWriteIn: 0 };
  let hasClaudeUsage = false;

  for (const r of parseLines(tail)) {
    const p = (r as { payload?: { type?: unknown; info?: { total_token_usage?: Record<string, unknown> } } }).payload;
    if (p?.type === "token_count") {
      const u = p.info?.total_token_usage ?? {};
      codexFound = {
        tokensIn: num(u.input_tokens),
        tokensOut: num(u.output_tokens),
        cachedIn: num(u.cached_input_tokens),
      };
      continue;
    }

    const usage = usageOf(r);
    if (!usage) continue;
    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);
    const cacheWrite = num(usage.cache_creation_input_tokens);
    if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) {
      continue;
    }
    hasClaudeUsage = true;
    claudeSum.tokensIn += input + cacheRead + cacheWrite;
    claudeSum.tokensOut += output;
    claudeSum.cachedIn += cacheRead;
    claudeSum.cacheWriteIn += cacheWrite;
  }
  if (codexFound) return codexFound;
  return hasClaudeUsage ? claudeSum : null;
}

/** First parseable top-level `timestamp` in the head, as epoch ms. */
export function startMsOf(head: string): number | undefined {
  for (const r of parseLines(head)) {
    const ts = (r as { timestamp?: unknown }).timestamp;
    if (typeof ts === "string") {
      const ms = Date.parse(ts);
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return undefined;
}

/** First model in the head. */
export function modelOf(head: string): string | undefined {
  for (const r of parseLines(head)) {
    const rec = r as {
      model?: unknown;
      payload?: { model?: unknown };
      message?: { model?: unknown };
      response?: { model?: unknown };
      request?: { model?: unknown };
    };
    const m = rec.payload?.model ?? rec.message?.model ?? rec.response?.model ?? rec.request?.model ?? rec.model;
    if (typeof m === "string" && m) return m;
  }
  return undefined;
}

// Standard short-context USD per 1M tokens. Estimates only; update when prices change.
// Sources:
// https://developers.openai.com/api/docs/pricing
// https://platform.claude.com/docs/en/about-claude/pricing
const PRICES: Array<{ match: RegExp; inUsd: number; cachedUsd: number; outUsd: number; cacheWriteUsd?: number }> = [
  { match: /gpt-5\.5-pro/i, inUsd: 30, cachedUsd: 30, outUsd: 180 },
  { match: /gpt-5\.5/i, inUsd: 5, cachedUsd: 0.5, outUsd: 30 },
  { match: /gpt-5\.4-mini/i, inUsd: 0.75, cachedUsd: 0.075, outUsd: 4.5 },
  { match: /gpt-5\.4-nano/i, inUsd: 0.2, cachedUsd: 0.02, outUsd: 1.25 },
  { match: /gpt-5\.4/i, inUsd: 2.5, cachedUsd: 0.25, outUsd: 15 },
  { match: /gpt-5\.3-codex/i, inUsd: 1.75, cachedUsd: 0.175, outUsd: 14 },
  { match: /chat-latest/i, inUsd: 5, cachedUsd: 0.5, outUsd: 30 },
  { match: /gpt-4|o4|o3/i, inUsd: 2.5, cachedUsd: 0.25, outUsd: 10 },
  { match: /claude.*haiku/i, inUsd: 1, cachedUsd: 0.1, outUsd: 5, cacheWriteUsd: 1.25 },
  { match: /claude.*sonnet/i, inUsd: 3, cachedUsd: 0.3, outUsd: 15, cacheWriteUsd: 3.75 },
  { match: /claude.*opus/i, inUsd: 5, cachedUsd: 0.5, outUsd: 25, cacheWriteUsd: 6.25 },
];
const FALLBACK = { inUsd: 2, cachedUsd: 0.2, outUsd: 10 };

/** Estimate cost, pricing the cached input subset ~10x cheaper than fresh input. */
export function estimateCostUsd(
  tokensIn: number,
  tokensOut: number,
  cachedIn: number,
  model?: string,
  cacheWriteIn = 0,
): number {
  const rate = (model && PRICES.find((p) => p.match.test(model))) || FALLBACK;
  const totalIn = Math.max(0, tokensIn);
  const cacheRead = Math.min(Math.max(0, cachedIn), totalIn);
  const cacheWrite = Math.min(Math.max(0, cacheWriteIn), Math.max(0, totalIn - cacheRead));
  const freshIn = Math.max(0, totalIn - cacheRead - cacheWrite);
  const cacheWriteUsd = "cacheWriteUsd" in rate && typeof rate.cacheWriteUsd === "number"
    ? rate.cacheWriteUsd
    : rate.inUsd;
  return (
    (freshIn / 1e6) * rate.inUsd +
    (cacheRead / 1e6) * rate.cachedUsd +
    (cacheWrite / 1e6) * cacheWriteUsd +
    (Math.max(0, tokensOut) / 1e6) * rate.outUsd
  );
}

function ymd(ms: number): string {
  const d = new Date(ms);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function aggregateDashboard(stats: ConvStat[], now: number): DashboardModel {
  let totalTokensIn = 0;
  let totalCachedIn = 0;
  let totalTokensOut = 0;
  let estCostUsd = 0;
  const byProject = new Map<string, ProjectRow>();
  const byDay = new Map<string, number>();

  for (const s of stats) {
    const tIn = s.tokensIn ?? 0;
    const cIn = s.cachedIn ?? 0;
    const cWrite = s.cacheWriteIn ?? 0;
    const tOut = s.tokensOut ?? 0;
    totalTokensIn += tIn;
    totalCachedIn += cIn;
    totalTokensOut += tOut;
    estCostUsd += estimateCostUsd(tIn, tOut, cIn, s.model, cWrite);

    const project = s.project ?? "(unknown)";
    const row = byProject.get(project) ?? { project, count: 0, tokens: 0, lastActive: 0 };
    row.count += 1;
    row.tokens += tIn + tOut;
    row.lastActive = Math.max(row.lastActive, s.lastModified);
    byProject.set(project, row);

    const day = ymd(s.startMs ?? s.lastModified);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const projects = [...byProject.values()].sort((a, b) => b.lastActive - a.lastActive);

  const activity: DayBar[] = [];
  const nowDate = new Date(now);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(nowDate);
    d.setDate(nowDate.getDate() - i);
    const day = ymd(d.getTime());
    activity.push({ day, count: byDay.get(day) ?? 0 });
  }

  return {
    conversationCount: stats.length,
    totalTokensIn,
    totalCachedIn,
    totalTokensOut,
    estCostUsd,
    projects,
    activity,
  };
}
