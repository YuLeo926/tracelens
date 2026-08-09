import * as fs from "node:fs/promises";
import { appendFile, mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
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

  it("backfills the requested limit when a newer discovered run is malformed", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const valid = path.join(home, ".codex", "sessions", "valid.jsonl");
    await writeCodexSession(valid, cwd, "Valid run");
    const malformed = path.join(home, ".codex", "sessions", "malformed.jsonl");
    await writeCodexSession(malformed, cwd, "Malformed run");
    await appendFile(malformed, "{ malformed json\n");
    const older = new Date("2026-07-31T10:00:00.000Z");
    const newer = new Date("2026-07-31T11:00:00.000Z");
    await utimes(valid, older, older);
    await utimes(malformed, newer, newer);

    const repository = await createSessionRepository({ homeDir: home, cwd });

    await expect(repository.list({ scope: "all", limit: 1 })).resolves.toMatchObject([{ title: "Valid run" }]);
    await expect(repository.list({ scope: "all", limit: 1 })).resolves.toHaveLength(1);
  });

  it("caches stable raw loads, invalidates changed files, and keeps public summaries path-free", async () => {
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
    const sourceRecords = first.source.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(sourceRecords[1].payload.cwd).toBe(cwd);
    expect(first.query.timeline().items[0].name).not.toContain(home);

    await appendFile(file, "\n");
    const changed = await repository.load(summary.id);
    expect(changed).not.toBe(first);
  });

  it("marks a snapshot active when the file changes during both read attempts", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const file = path.join(home, ".codex", "sessions", "changing.jsonl");
    await writeCodexSession(file, cwd);
    let reads = 0;
    const changingRepository = await createSessionRepository(
      { homeDir: home, cwd },
      {
        stat: fs.stat,
        async readFile(filePath) {
          reads += 1;
          const result = await fs.readFile(filePath, "utf8");
          if (reads <= 2) {
            await appendFile(
              file,
              `${JSON.stringify({
                type: "response_item",
                timestamp: `2026-07-31T10:00:0${reads + 1}.000Z`,
                payload: { type: "message", role: "assistant", content: `event-${reads}` },
              })}\n`,
            );
          }
          return result;
        },
      },
    );
    const [changingSummary] = await changingRepository.list();
    const loaded = await changingRepository.load(changingSummary.id);

    expect(changingSummary.lifecycle).toBe("active");
    expect(reads).toBe(3);
    expect(loaded.source).toContain("event-2");
  });

  it("keeps raw local evidence internally while sanitizing public and query text", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const file = path.join(home, ".codex", "sessions", "file-uri.jsonl");
    const posixUri = "file:///tmp/private.jsonl";
    const windowsUri = "file:///C:/Users/Ada/private.jsonl";
    await writeCodexSession(file, cwd, `Inspect ${posixUri} and ${windowsUri}`);
    const repository = await createSessionRepository({ homeDir: home, cwd });
    const [summary] = await repository.list();
    const loaded = await repository.load(summary.id);

    expectNoAbsolutePath(summary, posixUri);
    expectNoAbsolutePath(summary, windowsUri);
    expect(loaded.source).toContain(posixUri);
    expect(loaded.source).toContain(windowsUri);
    expect(loaded.query.timeline().items.map((item) => item.name).join(" ")).not.toContain(posixUri);
  });

  it("parses distinct absolute-path inputs and path-like IDs before output sanitization", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const explicitFile = path.join(home, "raw-identity.json");
    const windowsId = "C:\\private\\events\\first.json";
    const posixId = "/var/private/events/second.json";
    const windowsInput = "C:\\private\\inputs\\first.txt";
    const posixInput = "/var/private/inputs/second.txt";
    await writeFile(explicitFile, JSON.stringify([
      {
        span_id: windowsId,
        trace_id: "trace",
        name: "read_file",
        start_time: 1,
        end_time: 2,
        status_code: "OK",
        attributes: { "openinference.span.kind": "TOOL", "input.value": windowsInput },
      },
      {
        span_id: posixId,
        trace_id: "trace",
        name: "read_file",
        start_time: 3,
        end_time: 4,
        status_code: "OK",
        attributes: { "openinference.span.kind": "TOOL", "input.value": posixInput },
      },
    ]));
    const repository = await createSessionRepository({ homeDir: home, cwd, explicitFile });
    const [summary] = await repository.list({ scope: "all" });
    const loaded = await repository.load(summary.id);

    expect([...loaded.trace.byId.keys()]).toEqual([windowsId, posixId]);
    expect(loaded.trace.byId.get(windowsId)?.input).toBe(windowsInput);
    expect(loaded.trace.byId.get(posixId)?.input).toBe(posixInput);
    expect(loaded.facts.repeatedOperations).toEqual([]);
  });

  it("accepts one unterminated malformed tail only for discovered active JSONL", async () => {
    const home = await makeHome();
    const cwd = path.join(home, "work", "tracelens");
    const file = path.join(home, ".codex", "sessions", "active.jsonl");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, [
      JSON.stringify({ type: "thread.started", thread_id: "active-thread" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "item.completed", item: { id: "item-1", type: "agent_message", text: "Working" } }),
      '{"type":"item.started"',
    ].join("\n"));

    const discovered = await createSessionRepository({ homeDir: home, cwd });
    const summaries = await discovered.list({ scope: "all", limit: 1 });

    expect(summaries).toHaveLength(1);
    expect(summaries[0].lifecycle).toBe("active");
    expect((await discovered.load(summaries[0].id)).trace.byId.has("item-1")).toBe(true);

    const explicit = await createSessionRepository({ homeDir: home, cwd, explicitFile: file });
    await expect(explicit.list({ scope: "all" })).resolves.toEqual([]);
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
