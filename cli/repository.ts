import * as fs from "node:fs/promises";
import path from "node:path";
import { parseTraceText } from "../src/core/parse";
import { buildRunFacts } from "../src/core/session/facts";
import { createSessionQuery, type SessionQuery } from "../src/core/session/query";
import { clipText, redactText } from "../src/core/session/sanitize";
import { inspectSessionSource } from "../src/core/session/source";
import type {
  ProjectMatch,
  RunFacts,
  SessionLifecycle,
  SessionProvider,
  SessionSummary,
} from "../src/core/session/types";
import type { ParsedTrace } from "../src/core/types";
import {
  discoverExplicitSessionCandidate,
  discoverSessionCandidates,
  rankSessionCandidates,
  type DiscoverOptions,
} from "./discovery";
import type { SessionCandidate } from "./types";

const LIST_LIMIT = 20;

export interface LoadedSession {
  summary: SessionSummary;
  trace: ParsedTrace;
  facts: RunFacts;
  query: SessionQuery;
  source: string;
}

export interface SessionRepository {
  list(args?: {
    scope?: "current_project" | "all";
    provider?: SessionProvider;
    limit?: number;
  }): Promise<SessionSummary[]>;
  load(sessionId: string): Promise<LoadedSession>;
  refresh(): Promise<void>;
}

export interface RepositoryOptions extends DiscoverOptions {
  explicitFile?: string;
}

export class SessionNotFoundError extends Error {
  constructor() {
    super("Session expired; call list_sessions again.");
    this.name = "SessionNotFoundError";
  }
}

interface CacheEntry {
  stamp: string;
  loaded: LoadedSession;
}

interface ReadSnapshot {
  text: string;
  modifiedAt: number;
  sizeBytes: number;
  unstable: boolean;
}

interface RepositoryFileSystem {
  stat(filePath: string): Promise<{ mtimeMs: number; size: number }>;
  readFile(filePath: string, encoding: "utf8"): Promise<string>;
}

function stamp(modifiedAt: number, sizeBytes: number): string {
  return `${modifiedAt}:${sizeBytes}`;
}

function cappedLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return LIST_LIMIT;
  return Math.min(LIST_LIMIT, Math.max(1, Math.floor(limit as number)));
}

function publicText(value: string | undefined, maxChars = 120): string | undefined {
  if (value === undefined) return undefined;
  return clipText(value, maxChars).text;
}

function selectionReason(match: ProjectMatch, isCurrentProjectFallback: boolean): string {
  const reason = isCurrentProjectFallback
    ? "No current-project sessions found; showing newest available session."
    : match === "exact"
      ? "Matches current project."
      : match === "related"
        ? "Related to current project."
        : "Selected from all discovered sessions.";
  return publicText(reason, 160) ?? "";
}

function summaryFor(
  candidate: SessionCandidate,
  facts: RunFacts,
  lifecycle: SessionLifecycle,
  reason: string,
): SessionSummary {
  return {
    id: candidate.id,
    provider: candidate.provider,
    ...(publicText(candidate.title) === undefined ? {} : { title: publicText(candidate.title) }),
    ...(publicText(candidate.project) === undefined ? {} : { project: publicText(candidate.project) }),
    modifiedAt: candidate.modifiedAt,
    sizeBytes: candidate.sizeBytes,
    ...(candidate.startMs === undefined ? {} : { startMs: candidate.startMs }),
    lifecycle,
    match: candidate.match,
    selectionReason: publicText(reason, 160) ?? "",
    facts,
  };
}

async function readStableSnapshot(filePath: string, fileSystem: RepositoryFileSystem): Promise<ReadSnapshot> {
  let latest: ReadSnapshot | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await fileSystem.stat(filePath);
    const text = await fileSystem.readFile(filePath, "utf8");
    const after = await fileSystem.stat(filePath);
    const changed = before.mtimeMs !== after.mtimeMs || before.size !== after.size;
    latest = { text, modifiedAt: after.mtimeMs, sizeBytes: after.size, unstable: changed };
    if (!changed) return latest;
  }
  return { ...latest!, unstable: true };
}

export async function createSessionRepository(
  options: RepositoryOptions,
  fileSystem: RepositoryFileSystem = fs,
): Promise<SessionRepository> {
  let candidates: SessionCandidate[] = [];
  const cache = new Map<string, CacheEntry>();

  async function refresh(): Promise<void> {
    if (options.explicitFile === undefined) {
      candidates = await discoverSessionCandidates(options);
    } else {
      const explicit = await discoverExplicitSessionCandidate(options.explicitFile, options.cwd);
      candidates = explicit ? [explicit] : [];
    }
    candidates = rankSessionCandidates(candidates, options.cwd);
  }

  async function loadCandidate(candidate: SessionCandidate): Promise<LoadedSession> {
    let currentStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      currentStat = await fileSystem.stat(candidate.path);
    } catch {
      throw new SessionNotFoundError();
    }

    const cached = cache.get(candidate.path);
    if (cached && cached.stamp === stamp(currentStat.mtimeMs, currentStat.size)) return cached.loaded;

    let snapshot: ReadSnapshot;
    try {
      snapshot = await readStableSnapshot(candidate.path, fileSystem);
    } catch {
      throw new SessionNotFoundError();
    }

    const inspection = inspectSessionSource(path.basename(candidate.path), snapshot.text, snapshot.text);
    const lifecycle = snapshot.unstable ? "active" : inspection?.lifecycle ?? candidate.lifecycle;
    const updatedCandidate: SessionCandidate = {
      ...candidate,
      ...(inspection?.title === undefined ? {} : { title: inspection.title }),
      ...(inspection?.project === undefined ? {} : { project: inspection.project }),
      ...(inspection?.projectPath === undefined ? {} : { projectPath: inspection.projectPath }),
      ...(inspection?.startMs === undefined ? {} : { startMs: inspection.startMs }),
      modifiedAt: snapshot.modifiedAt,
      sizeBytes: snapshot.sizeBytes,
      lifecycle,
    };

    try {
      const source = redactText(snapshot.text);
      const trace = parseTraceText(source);
      const facts = buildRunFacts(trace, lifecycle);
      const loaded: LoadedSession = {
        summary: summaryFor(updatedCandidate, facts, lifecycle, selectionReason(updatedCandidate.match, false)),
        trace,
        facts,
        query: createSessionQuery(trace),
        source,
      };
      if (!snapshot.unstable) {
        cache.set(candidate.path, { stamp: stamp(snapshot.modifiedAt, snapshot.sizeBytes), loaded });
      }
      return loaded;
    } catch (error) {
      cache.delete(candidate.path);
      throw error;
    }
  }

  await refresh();

  return {
    async list(args = {}) {
      const scope = args.scope ?? "current_project";
      const providerCandidates = args.provider === undefined
        ? candidates
        : candidates.filter((candidate) => candidate.provider === args.provider);
      const projectCandidates = providerCandidates.filter((candidate) => candidate.match !== "fallback");
      const isCurrentProjectFallback = scope === "current_project" && projectCandidates.length === 0;
      const selected = (scope === "current_project" && !isCurrentProjectFallback ? projectCandidates : providerCandidates)
        .slice(0, cappedLimit(args.limit));
      const summaries: SessionSummary[] = [];
      for (const candidate of selected) {
        try {
          const loaded = await loadCandidate(candidate);
          summaries.push({
            ...loaded.summary,
            selectionReason: selectionReason(candidate.match, isCurrentProjectFallback),
          });
        } catch {
          // A file can disappear or become invalid after discovery. Omit it from list results.
        }
      }
      return summaries;
    },
    async load(sessionId) {
      const candidate = candidates.find((item) => item.id === sessionId);
      if (!candidate) throw new SessionNotFoundError();
      return loadCandidate(candidate);
    },
    refresh,
  };
}
