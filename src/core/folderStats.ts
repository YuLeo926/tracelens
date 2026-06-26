export interface ConvStat {
  name: string;
  project?: string;
  startMs?: number;
  lastModified: number;
  tokensIn?: number;     // total prompt tokens (INCLUDING cached)
  cachedIn?: number;     // the cached subset of tokensIn (billed ~10x cheaper)
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
      out.push(JSON.parse(t));
    } catch {
      /* skip partial/truncated lines */
    }
  }
  return out;
}

/** Codex cumulative tokens = the LAST token_count event in the tail.
 *  `input_tokens` is the TOTAL prompt (Codex re-sends context each turn), of
 *  which `cached_input_tokens` is the cheap cached subset. */
export function extractTokens(
  tail: string,
): { tokensIn: number; tokensOut: number; cachedIn: number } | null {
  let found: { tokensIn: number; tokensOut: number; cachedIn: number } | null = null;
  for (const r of parseLines(tail)) {
    const p = (r as { payload?: { type?: unknown; info?: { total_token_usage?: Record<string, unknown> } } }).payload;
    if (p?.type === "token_count") {
      const u = p.info?.total_token_usage ?? {};
      const num = (v: unknown) => (typeof v === "number" ? v : 0);
      found = {
        tokensIn: num(u.input_tokens),
        tokensOut: num(u.output_tokens),
        cachedIn: num(u.cached_input_tokens),
      };
    }
  }
  return found;
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

/** First `payload.model` in the head. */
export function modelOf(head: string): string | undefined {
  for (const r of parseLines(head)) {
    const m = (r as { payload?: { model?: unknown } }).payload?.model;
    if (typeof m === "string" && m) return m;
  }
  return undefined;
}

// Rough USD per 1M tokens. Estimates only — update here if prices change.
// `cachedUsd` is the (much cheaper) rate for cached/re-sent input.
const PRICES: Array<{ match: RegExp; inUsd: number; cachedUsd: number; outUsd: number }> = [
  { match: /gpt-5/i, inUsd: 1.25, cachedUsd: 0.125, outUsd: 10 },
  { match: /gpt-4|o4|o3/i, inUsd: 2.5, cachedUsd: 0.25, outUsd: 10 },
  { match: /claude/i, inUsd: 3, cachedUsd: 0.3, outUsd: 15 },
];
const FALLBACK = { inUsd: 2, cachedUsd: 0.2, outUsd: 10 };

/** Estimate cost, pricing the cached input subset ~10x cheaper than fresh input. */
export function estimateCostUsd(
  tokensIn: number,
  tokensOut: number,
  cachedIn: number,
  model?: string,
): number {
  const rate = (model && PRICES.find((p) => p.match.test(model))) || FALLBACK;
  const freshIn = Math.max(0, tokensIn - cachedIn);
  return (freshIn / 1e6) * rate.inUsd + (cachedIn / 1e6) * rate.cachedUsd + (tokensOut / 1e6) * rate.outUsd;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
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
    const tOut = s.tokensOut ?? 0;
    totalTokensIn += tIn;
    totalCachedIn += cIn;
    totalTokensOut += tOut;
    estCostUsd += estimateCostUsd(tIn, tOut, cIn, s.model);

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
  for (let i = 13; i >= 0; i--) {
    const day = ymd(now - i * 86_400_000);
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
