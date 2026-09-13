import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSelfCheck } from "./check";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("local self-check", () => {
  it("exercises real MCP and HTTP without sessions or leaking local paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tracelens-check-test-")); roots.push(root);
    const webRoot = path.join(root, "web"); await mkdir(webRoot); await writeFile(path.join(webRoot, "index.html"), "<html></html>");
    const report = await runSelfCheck({ homeDir: root, cwd: root, webRoot, version: "test" });
    expect(report.status).toBe("warn");
    for (const id of ["viewer-assets", "parser", "mcp", "viewer-http"]) expect(report.checks.find((item) => item.id === id)?.status).toBe("pass");
    expect(report.scope).toContain("not tested");
    expect(JSON.stringify(report)).not.toContain(root);
  });

  it("reports missing assets and discovery errors as failures with actions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tracelens-check-test-")); roots.push(root);
    const report = await runSelfCheck({ homeDir: root, cwd: root, webRoot: root, version: "test", createRepository: async () => { throw new Error("private path"); } });
    expect(report.status).toBe("fail");
    for (const id of ["viewer-assets", "local-session"]) expect(report.checks.find((item) => item.id === id)).toMatchObject({ status: "fail", action: expect.any(String) });
    expect(JSON.stringify(report)).not.toContain("private path");
  });
});
