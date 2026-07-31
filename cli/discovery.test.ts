import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSessionCandidates, rankSessionCandidates } from "./discovery";
import type { SessionCandidate } from "./types";

const homes: string[] = [];

async function makeHome() {
  const home = await mkdtemp(path.join(tmpdir(), "tracelens-discovery-"));
  homes.push(home);
  return home;
}

async function writeSession(file: string, records: unknown[]) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

function codex(projectPath: string, timestamp: string, title: string) {
  return [
    { type: "session_meta", timestamp, payload: { id: "session" } },
    { type: "turn_context", timestamp, payload: { cwd: projectPath } },
    { type: "response_item", timestamp, payload: { type: "message", role: "user", content: title } },
  ];
}

function claude(projectPath: string, timestamp: string, title: string) {
  return [
    { type: "user", timestamp, cwd: projectPath, message: { role: "user", content: title } },
    { type: "assistant", timestamp, message: { role: "assistant", stop_reason: "end_turn", content: "Done" } },
  ];
}

function publicSummary(candidate: SessionCandidate) {
  const { path: _path, projectPath: _projectPath, ...summary } = candidate;
  return summary;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("discoverSessionCandidates", () => {
  it("discovers supported Codex and Claude sessions without exposing local paths", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const codexFile = path.join(home, ".codex", "sessions", "2026", "07", "31", "rollout.jsonl");
    const claudeFile = path.join(home, ".claude", "projects", "tracelens", "session.jsonl");
    await writeSession(codexFile, codex(cwd, "2026-07-31T10:00:00.000Z", `Investigate ${cwd}`));
    await writeSession(claudeFile, claude(cwd, "2026-07-31T09:00:00.000Z", "Fix test"));
    await writeFile(path.join(home, ".codex", "sessions", "ignored.txt"), "not a trace");
    await writeFile(path.join(home, ".claude", "projects", "other.json"), JSON.stringify({ unrelated: true }));

    const candidates = await discoverSessionCandidates({ homeDir: home, cwd });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.provider).sort()).toEqual(["claude", "codex"]);
    expect(candidates.find((candidate) => candidate.provider === "codex")?.id).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(publicSummary(candidates[0]))).not.toContain(home);
  });

  it("skips missing roots, malformed JSONL, and non-trace JSON", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    await writeSession(path.join(home, ".codex", "sessions", "bad.jsonl"), [{ nope: true }]);
    await writeFile(path.join(home, ".codex", "sessions", "broken.jsonl"), "{ definitely not json\n");
    await writeFile(path.join(home, ".codex", "sessions", "plain.json"), JSON.stringify({ name: "not trace" }));

    await expect(discoverSessionCandidates({ homeDir: home, cwd })).resolves.toEqual([]);
  });
});

describe("rankSessionCandidates", () => {
  it("prefers exact then related then fallback projects and uses trace start time for mtime ties", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const exact = path.join(home, ".codex", "sessions", "exact.jsonl");
    const related = path.join(home, ".codex", "sessions", "related.jsonl");
    const fallback = path.join(home, ".codex", "sessions", "fallback.jsonl");
    await writeSession(exact, codex(cwd, "2026-07-31T10:00:00.000Z", "exact"));
    await writeSession(related, codex(path.dirname(cwd), "2026-07-31T11:00:00.000Z", "related"));
    await writeSession(fallback, codex(path.join(home, "other"), "2026-07-31T12:00:00.000Z", "fallback"));
    const tie = new Date("2026-07-31T13:00:00.000Z");
    await Promise.all([utimes(exact, tie, tie), utimes(related, tie, tie), utimes(fallback, tie, tie)]);

    const ranked = rankSessionCandidates(await discoverSessionCandidates({ homeDir: home, cwd }), cwd);

    expect(ranked.map((item) => [item.project, item.match])).toEqual([
      ["tracelens", "exact"],
      ["work", "related"],
      ["other", "fallback"],
    ]);
  });

  it("uses trace start time to break modification-time ties within the same project match", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const older = path.join(home, ".codex", "sessions", "older.jsonl");
    const newer = path.join(home, ".codex", "sessions", "newer.jsonl");
    await writeSession(older, codex(cwd, "2026-07-31T10:00:00.000Z", "older"));
    await writeSession(newer, codex(cwd, "2026-07-31T11:00:00.000Z", "newer"));
    const tie = new Date("2026-07-31T13:00:00.000Z");
    await Promise.all([utimes(older, tie, tie), utimes(newer, tie, tie)]);

    const ranked = await discoverSessionCandidates({ homeDir: home, cwd });

    expect(ranked.map((candidate) => candidate.title)).toEqual(["newer", "older"]);
  });

  it("matches Windows project paths case-insensitively", () => {
    const candidate: SessionCandidate = {
      id: createHash("sha256").update("candidate").digest("hex").slice(0, 32),
      path: "C:\\logs\\run.jsonl",
      provider: "codex",
      project: "tracelens",
      projectPath: "C:\\Users\\Ada\\Work\\TraceLens",
      modifiedAt: 1,
      sizeBytes: 1,
      lifecycle: "unknown",
      match: "fallback",
    };

    expect(rankSessionCandidates([candidate], "c:\\users\\ada\\work\\tracelens")[0].match).toBe("exact");
  });
});
