import path from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve the web build beside the bundled CLI, never relative to the caller's directory. */
export function resolveWebRoot(moduleUrl: string): string {
  let modulePath: string;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    // Keep bundled-location tests portable when they use a POSIX file URL on Windows.
    modulePath = decodeURIComponent(new URL(moduleUrl).pathname);
  }
  return path.normalize(path.join(path.dirname(modulePath), "..", "dist"));
}
