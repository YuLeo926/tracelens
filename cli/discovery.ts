import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { inspectSessionSource } from "../src/core/session/source";
import type { ProjectMatch } from "../src/core/session/types";
import type { SessionCandidate } from "./types";

const INSPECTION_BYTES = 256 * 1024;
const MAX_RECURSIVE_DEPTH = 8;

export interface DiscoverOptions {
  homeDir: string;
  cwd: string;
}

function hasSupportedExtension(filePath: string): boolean {
  return /\.jsonl?$/i.test(filePath);
}

function isWindowsPath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value) || value.includes("\\");
}

interface ComparablePath {
  style: "win32" | "posix";
  normalized: string;
  segments: string[];
}

function comparablePath(value: string): ComparablePath {
  if (isWindowsPath(value)) {
    const normalized = path.win32.normalize(value).replace(/[\\/]+$/, "").toLowerCase();
    return { style: "win32", normalized, segments: normalized.split(/[\\/]+/).filter(Boolean) };
  }
  const normalized = path.posix.normalize(value).replace(/\/+$/, "") || "/";
  return { style: "posix", normalized, segments: normalized.split("/").filter(Boolean) };
}

function normalizeComparablePath(value: string): string {
  return comparablePath(value).normalized;
}

function pathRelationship(projectPath: string | undefined, cwd: string): { match: ProjectMatch; distance: number } {
  if (!projectPath) return { match: "fallback", distance: Number.POSITIVE_INFINITY };
  const project = comparablePath(projectPath);
  const current = comparablePath(cwd);
  if (project.style !== current.style) return { match: "fallback", distance: Number.POSITIVE_INFINITY };
  if (project.normalized === current.normalized) return { match: "exact", distance: 0 };
  const shared = Math.min(project.segments.length, current.segments.length);
  for (let index = 0; index < shared; index += 1) {
    if (project.segments[index] !== current.segments[index]) {
      return { match: "fallback", distance: Number.POSITIVE_INFINITY };
    }
  }
  if (project.segments.length === current.segments.length) {
    return { match: "fallback", distance: Number.POSITIVE_INFINITY };
  }
  return { match: "related", distance: Math.abs(project.segments.length - current.segments.length) };
}

function pathMatch(projectPath: string | undefined, cwd: string): ProjectMatch {
  return pathRelationship(projectPath, cwd).match;
}

function opaqueId(provider: SessionCandidate["provider"], filePath: string): string {
  const normalizedPath = normalizeComparablePath(path.resolve(filePath));
  return createHash("sha256").update(`${provider}:${normalizedPath}`).digest("hex").slice(0, 32);
}

async function readInspectionText(filePath: string, sizeBytes: number): Promise<{ head: string; tail: string }> {
  const file = await open(filePath, "r");
  try {
    const headLength = Math.min(sizeBytes, INSPECTION_BYTES);
    const head = Buffer.alloc(headLength);
    const headRead = headLength === 0 ? 0 : (await file.read(head, 0, headLength, 0)).bytesRead;

    if (sizeBytes <= INSPECTION_BYTES) {
      return { head: head.subarray(0, headRead).toString("utf8"), tail: "" };
    }

    const tailLength = Math.min(sizeBytes, INSPECTION_BYTES);
    const tail = Buffer.alloc(tailLength);
    const tailRead = (await file.read(tail, 0, tailLength, sizeBytes - tailLength)).bytesRead;
    return {
      head: head.subarray(0, headRead).toString("utf8"),
      tail: tail.subarray(0, tailRead).toString("utf8"),
    };
  } finally {
    await file.close();
  }
}

async function candidateForFile(filePath: string, cwd: string): Promise<SessionCandidate | null> {
  if (!hasSupportedExtension(filePath)) return null;

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return null;
    const { head, tail } = await readInspectionText(filePath, fileStat.size);
    const source = inspectSessionSource(path.basename(filePath), head, tail);
    if (!source) return null;

    return {
      id: opaqueId(source.provider, filePath),
      path: path.resolve(filePath),
      provider: source.provider,
      ...(source.title === undefined ? {} : { title: source.title }),
      ...(source.project === undefined ? {} : { project: source.project }),
      ...(source.projectPath === undefined ? {} : { projectPath: source.projectPath }),
      modifiedAt: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      ...(source.startMs === undefined ? {} : { startMs: source.startMs }),
      lifecycle: source.lifecycle,
      match: pathMatch(source.projectPath, cwd),
    };
  } catch {
    return null;
  }
}

async function scanDirectory(root: string, depth: number, files: string[]): Promise<void> {
  if (depth > MAX_RECURSIVE_DEPTH) return;
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        await scanDirectory(entryPath, depth + 1, files);
      } else if (entry.isFile() && hasSupportedExtension(entry.name)) {
        files.push(entryPath);
      }
    }),
  );
}

export function rankSessionCandidates(candidates: SessionCandidate[], cwd: string): SessionCandidate[] {
  const rank = { exact: 0, related: 1, fallback: 2 } as const;
  return candidates
    .map((candidate) => {
      const relationship = pathRelationship(candidate.projectPath, cwd);
      return { candidate: { ...candidate, match: relationship.match }, distance: relationship.distance };
    })
    .sort((left, right) =>
      rank[left.candidate.match] - rank[right.candidate.match] ||
      left.distance - right.distance ||
      right.candidate.modifiedAt - left.candidate.modifiedAt ||
      (right.candidate.startMs ?? Number.NEGATIVE_INFINITY) - (left.candidate.startMs ?? Number.NEGATIVE_INFINITY) ||
      left.candidate.id.localeCompare(right.candidate.id),
    )
    .map(({ candidate }) => candidate);
}

export async function discoverSessionCandidates(options: DiscoverOptions): Promise<SessionCandidate[]> {
  const roots = [
    path.join(options.homeDir, ".codex", "sessions"),
    path.join(options.homeDir, ".claude", "projects"),
  ];
  const files: string[] = [];
  await Promise.all(roots.map((root) => scanDirectory(root, 0, files)));
  const candidates = (await Promise.all(files.map((filePath) => candidateForFile(filePath, options.cwd)))).filter(
    (candidate): candidate is SessionCandidate => candidate !== null,
  );
  return rankSessionCandidates(candidates, options.cwd);
}

/** Validate a user-selected file without consulting any standard discovery root. */
export async function discoverExplicitSessionCandidate(filePath: string, cwd: string): Promise<SessionCandidate | null> {
  return candidateForFile(filePath, cwd);
}
