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
  const limit = Math.max(0, Math.floor(maxChars));
  if (originalLength <= limit) {
    return { text: redacted, truncated: false, originalLength };
  }

  const marker = "...";
  const markerLength = Math.min(marker.length, limit);
  const prefixLength = limit - markerLength;
  return {
    text: `${redacted.slice(0, prefixLength)}${marker.slice(0, markerLength)}`,
    truncated: true,
    originalLength,
  };
}

export function safeAttributes(
  attributes: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const safeKey = redactText(key);
    if (typeof value === "string") safe[safeKey] = redactText(value);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      safe[safeKey] = value;
    }
  }
  return safe;
}
