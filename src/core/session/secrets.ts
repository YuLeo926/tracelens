const SECRET_KEY = /^(?:authorization|proxy-authorization|cookie|set-cookie|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|client[-_ ]?secret|password|passwd|secret|private[-_ ]?key)$/i;
const REDACTED = "[REDACTED]";

/** Best-effort credential masking, not a guarantee that arbitrary prose is private. */
export function redactSecrets(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, `$1 ${REDACTED}`)
    .replace(/(\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|secret|token)\s*[=:]\s*["']?)[^\s"'&,;]+/gi, `$1${REDACTED}`)
    .replace(/(^|\n)((?:set-cookie|cookie|authorization|proxy-authorization)\s*:\s*)[^\r\n]+/gi, `$1$2${REDACTED}`);
}

export function redactSecretValues(value: unknown, depth = 0): unknown {
  if (depth > 30) return "[OMITTED]";
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((child) => redactSecretValues(child, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_KEY.test(key) ? REDACTED : redactSecretValues(child, depth + 1)]));
  }
  return value;
}

export function redactEvidenceSecrets(text: string): string {
  if (/^\s*[{[]/.test(text)) {
    try { return JSON.stringify(redactSecretValues(JSON.parse(text))); } catch { /* Non-JSON log text. */ }
  }
  return redactSecrets(text);
}
