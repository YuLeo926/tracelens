import { request } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewerService } from "./server";
import type { SessionRepository } from "./repository";

const directories: string[] = [];
const token = "b".repeat(64);

async function makeDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function createWebRoot(): Promise<string> {
  const root = await makeDirectory("tracelens-viewer-web-");
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "index.html"), "<main>TraceLens</main>");
  await writeFile(path.join(root, "assets", "app.js"), "console.log('viewer');");
  return root;
}

function repository(): SessionRepository {
  return {
    list: vi.fn().mockResolvedValue([{ id: "session-1", title: "Trace" }]),
    load: vi.fn().mockResolvedValue({
      summary: { id: "session-1", title: "Trace" },
      source: '{"spans":[]}',
    }),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionRepository;
}

function serverOrigin(link: string): string {
  const url = new URL(link);
  return url.origin;
}

function get(origin: string, requestPath: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path: requestPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("createViewerService", () => {
  it("serves authenticated JSON without CORS and returns encoded reusable viewer links", async () => {
    const service = createViewerService({ repository: repository(), webRoot: await createWebRoot(), token });
    const first = await service.getLink("session / one", "event & one");
    const second = await service.getLink("another session");
    const firstUrl = new URL(first);

    expect(firstUrl.pathname).toBe("/tracelens/");
    expect(firstUrl.searchParams.get("mode")).toBe("session");
    expect(firstUrl.searchParams.get("session")).toBe("session / one");
    expect(firstUrl.searchParams.get("event")).toBe("event & one");
    expect(firstUrl.hash).toBe(`#token=${token}`);
    expect(serverOrigin(second)).toBe(serverOrigin(first));
    expect(second).not.toContain("event=");

    await expect(get(serverOrigin(first), "/api/sessions")).resolves.toMatchObject({ status: 401 });
    await expect(get(serverOrigin(first), "/api/sessions", { authorization: "Bearer wrong" })).resolves.toMatchObject({ status: 401 });
    await expect(
      get(serverOrigin(first), "/api/sessions", { authorization: `Bearer ${token.slice(0, -1)}é` }),
    ).resolves.toMatchObject({ status: 401 });
    const listed = await get(serverOrigin(first), "/api/sessions", authHeaders());
    expect(listed.status).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.headers["access-control-allow-origin"]).toBeUndefined();
    expect(JSON.parse(listed.body)).toEqual([{ id: "session-1", title: "Trace" }]);

    const loaded = await get(serverOrigin(first), "/api/sessions/session-1", authHeaders());
    expect(loaded.status).toBe(200);
    expect(JSON.parse(loaded.body)).toEqual({ session: { id: "session-1", title: "Trace" }, source: '{"spans":[]}' });
    await service.close();
  });

  it("resolves a session-scoped opaque event alias without exposing the raw event in the link", async () => {
    const rawEventId = "C:\\private\\traces\\event.json";
    const eventAlias = `evt_${"c".repeat(64)}`;
    const service = createViewerService({ repository: repository(), webRoot: await createWebRoot(), token });
    const link = await service.getLink("session-1", rawEventId, eventAlias);
    const url = new URL(link);

    expect(url.searchParams.get("event")).toBe(eventAlias);
    expect(decodeURIComponent(link)).not.toContain(rawEventId);

    const loaded = await get(
      url.origin,
      `/api/sessions/session-1?event=${encodeURIComponent(eventAlias)}`,
      authHeaders(),
    );
    expect(loaded.status).toBe(200);
    expect(JSON.parse(loaded.body)).toEqual({
      session: { id: "session-1", title: "Trace" },
      source: '{"spans":[]}',
      selectedEventId: rawEventId,
    });

    const otherSession = await get(
      url.origin,
      `/api/sessions/session-2?event=${encodeURIComponent(eventAlias)}`,
      authHeaders(),
    );
    expect(JSON.parse(otherSession.body)).toEqual({
      session: { id: "session-1", title: "Trace" },
      source: '{"spans":[]}',
    });
    await service.close();
  });

  it("keeps API and static routing contained under their intended roots", async () => {
    const root = await createWebRoot();
    const outside = await makeDirectory("tracelens-viewer-outside-");
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "assets", "escape"), "junction");
    const service = createViewerService({ repository: repository(), webRoot: root, token });
    const origin = serverOrigin(await service.getLink("session-1"));

    await expect(get(origin, "/api/unknown", authHeaders())).resolves.toMatchObject({ status: 404 });
    await expect(get(origin, "/tracelens/assets/app.js")).resolves.toMatchObject({ status: 200, body: "console.log('viewer');" });
    await expect(get(origin, "/tracelens/%2e%2e/%2e%2e/secret.txt")).resolves.toMatchObject({ status: 404 });
    await expect(get(origin, "/tracelens/assets/escape/secret.txt")).resolves.toMatchObject({ status: 404 });
    await expect(get(origin, "/tracelens/session/view")).resolves.toMatchObject({ status: 200, body: "<main>TraceLens</main>" });
    await service.close();
  });

  it("shuts down after inactivity and only authenticated successful API responses extend its lifetime", async () => {
    const service = createViewerService({ repository: repository(), webRoot: await createWebRoot(), token, idleMs: 70 });
    const origin = serverOrigin(await service.getLink("session-1"));
    await new Promise((resolve) => setTimeout(resolve, 45));
    await expect(get(origin, "/api/sessions")).resolves.toMatchObject({ status: 401 });
    await new Promise((resolve) => setTimeout(resolve, 45));
    await expect(get(origin, "/api/sessions", authHeaders())).rejects.toThrow();

    const restarted = serverOrigin(await service.getLink("session-1"));
    await new Promise((resolve) => setTimeout(resolve, 45));
    await expect(get(restarted, "/api/sessions", authHeaders())).resolves.toMatchObject({ status: 200 });
    await new Promise((resolve) => setTimeout(resolve, 45));
    await expect(get(restarted, "/api/sessions", authHeaders())).resolves.toMatchObject({ status: 200 });
    await service.close();
  });

  it("resolves closed for both explicit and idle shutdown", async () => {
    const explicit = createViewerService({ repository: repository(), webRoot: await createWebRoot(), token });
    let explicitClosures = 0;
    void explicit.closed.then(() => {
      explicitClosures += 1;
    });
    await explicit.getLink("session-1");
    await Promise.all([explicit.close(), explicit.close()]);
    await expect(explicit.closed).resolves.toBeUndefined();
    expect(explicitClosures).toBe(1);

    const idle = createViewerService({ repository: repository(), webRoot: await createWebRoot(), token, idleMs: 10 });
    let idleClosures = 0;
    void idle.closed.then(() => {
      idleClosures += 1;
    });
    await idle.getLink("session-1");
    await expect(idle.closed).resolves.toBeUndefined();
    await idle.close();
    expect(idleClosures).toBe(1);
  });
});
