import { describe, expect, it } from "vitest";
import { copyShareLinkToClipboard } from "./exportActions";

describe("copyShareLinkToClipboard", () => {
  it("writes the encoded share URL and reports success", async () => {
    let written = "";
    const ok = await copyShareLinkToClipboard({
      rawSource: "{}",
      label: "trace.json",
      baseUrl: "https://example.test/app",
      encode: async (payload) => {
        expect(payload).toEqual({ name: "trace.json", source: "{}" });
        return "encoded-token";
      },
      writeText: async (text) => {
        written = text;
      },
    });

    expect(ok).toBe(true);
    expect(written).toBe("https://example.test/app#t=encoded-token");
  });

  it("reports failure when encoding or clipboard write fails", async () => {
    await expect(
      copyShareLinkToClipboard({
        rawSource: "{}",
        label: "trace.json",
        baseUrl: "https://example.test/app",
        encode: async () => {
          throw new Error("no compression");
        },
        writeText: async () => {
          throw new Error("should not be called");
        },
      }),
    ).resolves.toBe(false);
  });

  it("does not try to write an empty source", async () => {
    let called = false;
    const ok = await copyShareLinkToClipboard({
      rawSource: "",
      label: "trace.json",
      baseUrl: "https://example.test/app",
      writeText: async () => {
        called = true;
      },
    });

    expect(ok).toBe(false);
    expect(called).toBe(false);
  });
});
