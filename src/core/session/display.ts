import { redactText } from "./sanitize";

/** Normalizes session metadata and fact labels for the local viewer surface. */
export function sessionDisplayText(value: string | undefined, fallback = ""): string {
  const text = redactText(value ?? "")
    .replace(/root cause/gi, "cause")
    .replace(/loop/gi, "repetition")
    .replace(/raw input/gi, "content")
    .replace(/raw output/gi, "content")
    .trim();
  return text || fallback;
}
