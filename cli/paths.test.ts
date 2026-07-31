import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWebRoot } from "./paths";

describe("resolveWebRoot", () => {
  it("uses the bundled module location instead of the caller working directory", () => {
    expect(resolveWebRoot("file:///opt/app/dist-cli/index.js")).toBe(path.normalize("/opt/app/dist"));
  });
});
