export interface ClippedText {
  text: string;
  truncated: boolean;
  originalLength: number;
}

const WINDOWS_PATH = /(^|[\s"'`=:(\[{,])[A-Za-z]:(?:\\{1,2}|\/)[^\s"'`<>|]*/gm;
const UNC_PATH = /\\{2,}[^\s"'`<>|]*/g;
const POSIX_PATH = /(^|[\s"'`=:(\[{,])\/(?!\/)[^\s"'`<>|]*/gm;

/** Remove machine-specific absolute paths while preserving relative paths and URLs. */
export function redactText(text: string): string {
  return text
    .replace(WINDOWS_PATH, "$1<absolute-path>")
    .replace(UNC_PATH, "<absolute-path>")
    .replace(POSIX_PATH, "$1<absolute-path>");
}

export function clipText(text: string, maxChars: number): ClippedText {
  const redacted = redactText(text);
  const originalLength = redacted.length;
  if (originalLength <= maxChars) {
    return { text: redacted, truncated: false, originalLength };
  }

  const marker = "...";
  const prefixLength = Math.max(0, maxChars - marker.length);
  return {
    text: `${redacted.slice(0, prefixLength)}${marker}`,
    truncated: true,
    originalLength,
  };
}

export function safeAttributes(
  attributes: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string") safe[key] = redactText(value);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      safe[key] = value;
    }
  }
  return safe;
}
