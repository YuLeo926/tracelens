import { describe, expect, it } from "vitest";
import { clipText, safeAttributes } from "./sanitize";

describe("clipText", () => {
  it("clips text with an explicit length marker", () => {
    expect(clipText("abcdef", 5)).toEqual({ text: "ab...", truncated: true, originalLength: 6 });
  });

  it("redacts Windows, UNC, and POSIX absolute paths without hiding relative paths or URLs", () => {
    const result = clipText(
      "C:\\Users\\alice\\trace.json \\\\\server\\share\\result.txt /var/tmp/trace.json ./relative/file https://example.com/path",
      1_000,
    );

    expect(result.text).toContain("<absolute-path>");
    expect(result.text.match(/<absolute-path>/g)).toHaveLength(3);
    expect(result.text).toContain("./relative/file");
    expect(result.text).toContain("https://example.com/path");
  });
});

describe("safeAttributes", () => {
  it("keeps primitive values, redacts strings, and removes object and array values", () => {
    expect(
      safeAttributes({
        windows: "C:\\Users\\alice\\trace.json",
        unc: "\\\\server\\share\\result.txt",
        posix: "/var/tmp/trace.json",
        relative: "./relative/file",
        url: "https://example.com/path",
        count: 3,
        enabled: true,
        absent: null,
        object: { nested: true },
        array: ["nested"],
      }),
    ).toEqual({
      windows: "<absolute-path>",
      unc: "<absolute-path>",
      posix: "<absolute-path>",
      relative: "./relative/file",
      url: "https://example.com/path",
      count: 3,
      enabled: true,
      absent: null,
    });
  });
});
