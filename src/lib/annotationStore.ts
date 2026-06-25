import type { StoredAnnotation } from "../core/annotations";

const KEY = "tracelens:annotations";
export type AnnotationStore = Record<string, Record<string, StoredAnnotation>>;

function storageOf(s?: Storage): Storage | null {
  if (s) return s;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadStore(s?: Storage): AnnotationStore {
  const storage = storageOf(s);
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as AnnotationStore) : {};
  } catch {
    return {};
  }
}

export function loadForLabel(label: string, s?: Storage): Record<string, StoredAnnotation> {
  return loadStore(s)[label] ?? {};
}

export function saveForLabel(
  label: string,
  anns: Record<string, StoredAnnotation>,
  s?: Storage,
): void {
  const storage = storageOf(s);
  if (!storage) return;
  try {
    const store = loadStore(storage);
    if (Object.keys(anns).length === 0) delete store[label];
    else store[label] = anns;
    storage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota or unavailable — in-memory annotations still work this session */
  }
}
