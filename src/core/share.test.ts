import { describe, it, expect } from "vitest";
import { encodeShare, decodeShare, readShareHash, shareUrl } from "./share";

describe("share encode/decode", () => {
  it("round-trips a payload including unicode and quotes/newlines", async () => {
    const p = { name: "trace.json", source: '{"q":"东京\\nhi \\"x\\""}' };
    const enc = await encodeShare(p);
    expect(await decodeShare(enc)).toEqual(p);
  });

  it("produces base64url with no +, / or =", async () => {
    const enc = await encodeShare({ name: "n", source: "{}" });
    expect(enc).not.toMatch(/[+/=]/);
  });

  it("rejects garbage input", async () => {
    await expect(decodeShare("@@@")).rejects.toThrow();
  });
});

describe("readShareHash", () => {
  it("extracts the t token", () => {
    expect(readShareHash("#t=abc")).toBe("abc");
    expect(readShareHash("#t=abc&x=1")).toBe("abc");
  });
  it("returns null when absent", () => {
    expect(readShareHash("#x=1")).toBeNull();
    expect(readShareHash("")).toBeNull();
  });
});

describe("shareUrl", () => {
  it("appends the hash token", () => {
    expect(shareUrl("https://x/app", "abc")).toBe("https://x/app#t=abc");
  });
});
