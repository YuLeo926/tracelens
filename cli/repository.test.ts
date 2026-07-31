import * as fs from "node:fs/promises";
import { appendFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionRepository, SessionNotFoundError } from "./repository";

const homes: string[] = [];

async function makeHome() {
  const home = await mkdtemp(path.join(tmpdir(), "tracelens-repository-"));
  homes.push(home);
  return home;
}

async function writeCodexSession(file: string, projectPath: string, title = "Inspect run") {
  await mkdir(path.dirname(file), { recursive: true });
  const records = [
    { type: "session_meta", timestamp: "2026-07-31T10:00:00.000Z", payload: { id: "session" } },
    { type: "turn_context", timestamp: "2026-07-31T10:00:00.000Z", payload: { cwd: projectPath } },
    { type: "response_item", timestamp: "2026-07-31T10:00:00.000Z", payload: { type: "message", role: "user", content: title } },
    { type: "response_item", timestamp: "2026-07-31T10:00:01.000Z", payload: { type: "message", role: "assistant", content: "Done" } },
  ];
  await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

function expectNoAbsolutePath(value: unknown, absolutePath: string): void {
  if (typeof value === "string") {
    expect(value).not.toContain(absolutePath);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => expectNoAbsolutePath(item, absolutePath));
    return;
  }
  if (value instanceof Map) {
    value.forEach((item) => expectNoAbsolutePath(item, absolutePath));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => expectNoAbsolutePath(item, absolutePath));
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("createSessionRepository", () => {
  it("caps list results and labels a current-project fallback", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "missing-project");
    for (let index = 0; index < 21; index += 1) {
      await writeCodexSession(path.join(home, ".codex", "sessions", `${index}.jsonl`), path.join(home, "other", String(index)));
    }
    const repository = await createSessionRepository({ homeDir: home, cwd });
    const summaries = await repository.list({ scope: "current_project", limit: 99 });

    expect(summaries).toHaveLength(20);
    expect(summaries.every((summary) => summary.selectionReason === "No current-project sessions found; showing newest available session.")).toBe(true);
  });

  it("skips malformed runs after lightweight discovery", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    await writeCodexSession(path.join(home, ".codex", "sessions", "valid.jsonl"), cwd, "Valid run");
    const malformed = path.join(home, ".codex", "sessions", "malformed.jsonl");
    await writeCodexSession(malformed, cwd, "Malformed run");
    await appendFile(malformed, "{ malformed json\n");

    const repository = await createSessionRepository({ homeDir: home, cwd });

    await expect(repository.list({ scope: "all" })).resolves.toMatchObject([{ title: "Valid run" }]);
    await expect(repository.list({ scope: "all" })).resolves.toHaveLength(1);
  });

  it("caches stable loads, invalidates changed files, and keeps every returned value path-free", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const file = path.join(home, ".codex", "sessions", "stable.jsonl");
    await writeCodexSession(file, cwd, `Investigate ${cwd}`);
    const repository = await createSessionRepository({ homeDir: home, cwd });
    const [summary] = await repository.list();

    const first = await repository.load(summary.id);
    const cached = await repository.load(summary.id);
    expect(cached).toBe(first);
    expectNoAbsolutePath(summary, home);
    expectNoAbsolutePath(first, home);

    await appendFile(file, "\n");
    const changed = await repository.load(summary.id);
    expect(changed).not.toBe(first);
  });

  it("marks a snapshot active when the file changes during both read attempts", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const file = path.join(home, ".codex", "sessions", "changing.jsonl");
    await writeCodexSession(file, cwd);
    const repository = await createSessionRepository({ homeDir: home, cwd });
    const [summary] = await repository.list();
    let reads = 0;
    const changingRepository = await createSessionRepository(
      { homeDir: home, cwd },
      {
        stat: fs.stat,
        async readFile(filePath) {
          reads += 1;
          const result = await fs.readFile(filePath, "utf8");
          await appendFile(file, " ");
          return result;
        },
      },
    );
    const [changingSummary] = await changingRepository.list();
    const loaded = await changingRepository.load(changingSummary.id);

    expect(reads).toBeGreaterThanOrEqual(2);
    expect(loaded.summary.lifecycle).toBe("active");
    expect(loaded.facts.lifecycle).toBe("active");
  });

  it("validates an explicit file without falling back to discovery roots", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    await writeCodexSession(path.join(home, ".codex", "sessions", "discovered.jsonl"), cwd);
    const explicitFile = path.join(home, "explicit.jsonl");
    await writeFile(explicitFile, JSON.stringify({ not: "a trace" }));

    const repository = await createSessionRepository({ homeDir: home, cwd, explicitFile });

    await expect(repository.list({ scope: "all" })).resolves.toEqual([]);
  });

  it("reports expired session IDs without substituting another run", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    await writeCodexSession(path.join(home, ".codex", "sessions", "session.jsonl"), cwd);
    const repository = await createSessionRepository({ homeDir: home, cwd });

    await expect(repository.load("unknown")).rejects.toEqual(
      expect.objectContaining<Partial<SessionNotFoundError>>({
        message: "Session expired; call list_sessions again.",
      }),
    );
  });
});
