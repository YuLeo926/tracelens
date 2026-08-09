import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [mode, markerPath, readyPath] = process.argv.slice(2);

if (mode === "descendant") {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind a TCP port.");
    const ready = { descendant: process.pid, port: address.port };
    writeFileSync(readyPath, JSON.stringify(ready));
    process.send?.(ready);
    process.disconnect?.();
  });
  process.on("SIGTERM", () => {});
  setTimeout(() => process.exit(0), 10_000).unref();
} else if (mode === "leader") {
  const fixturePath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [fixturePath, "descendant", markerPath, readyPath], {
    cwd: path.dirname(markerPath),
    env: process.env,
    shell: false,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  child.once("message", ({ descendant, port }) => {
    writeFileSync(markerPath, JSON.stringify({ leader: process.pid, descendant, port }));
    child.unref();
  });
} else {
  throw new Error(`Unknown fixture mode: ${mode ?? "missing"}`);
}
